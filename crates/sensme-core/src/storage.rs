//! SQLite persistence: schema migrations, tracks, versioned analyses and
//! classifications. rusqlite with the bundled SQLite (ADR-006).
//!
//! Feature vectors are stored as little-endian `f32` blobs — a fixed,
//! endian-explicit layout so stored vectors are byte-identical across
//! platforms (AGENTS.md §2).

use std::path::Path;

use rusqlite::{params, Connection};

use crate::error::CoreError;
use crate::models::{ChannelScores, FeatureVector, ToneAxes, Track, TrackId};

/// Current schema version. Migrations are numbered and additive.
const SCHEMA_VERSION: i64 = 1;

/// Open (creating if needed) the library database at `path`.
pub struct Library {
    conn: Connection,
}

impl Library {
    pub fn open(path: &Path) -> Result<Self, CoreError> {
        let conn = Connection::open(path).map_err(|e| CoreError::Storage(e.to_string()))?;
        Self::init(conn)
    }

    /// In-memory database for tests.
    pub fn open_in_memory() -> Result<Self, CoreError> {
        let conn = Connection::open_in_memory().map_err(|e| CoreError::Storage(e.to_string()))?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> Result<Self, CoreError> {
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        if version < 1 {
            conn.execute_batch(
                "BEGIN;
                CREATE TABLE tracks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    path TEXT NOT NULL UNIQUE,
                    title TEXT,
                    artist TEXT,
                    album TEXT,
                    genre TEXT,
                    year INTEGER,
                    duration_ms INTEGER NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    modified_epoch INTEGER NOT NULL
                );
                CREATE TABLE analyses (
                    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
                    algorithm_version TEXT NOT NULL,
                    feature_vector_version INTEGER NOT NULL,
                    features BLOB NOT NULL,
                    analyzed_at INTEGER NOT NULL
                );
                CREATE TABLE classifications (
                    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
                    weights_version TEXT NOT NULL,
                    axis_scores BLOB NOT NULL,
                    channel_scores BLOB NOT NULL,
                    classified_at INTEGER NOT NULL
                );
                PRAGMA user_version = 1;
                COMMIT;",
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        }
        debug_assert_eq!(SCHEMA_VERSION, 1);
        Ok(Self { conn })
    }

    // --- tracks ---

    /// Insert or refresh the track row for `track.path` (keyed by path).
    /// Returns the stable track id.
    pub fn upsert_track(&mut self, track: &Track) -> Result<TrackId, CoreError> {
        self.conn
            .execute(
                "INSERT INTO tracks (path, title, artist, album, genre, year,
                                     duration_ms, size_bytes, modified_epoch)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(path) DO UPDATE SET
                     title = excluded.title, artist = excluded.artist,
                     album = excluded.album, genre = excluded.genre,
                     year = excluded.year, duration_ms = excluded.duration_ms,
                     size_bytes = excluded.size_bytes,
                     modified_epoch = excluded.modified_epoch",
                params![
                    track.path,
                    track.title,
                    track.artist,
                    track.album,
                    track.genre,
                    track.year.map(|y| y as i64),
                    track.duration_ms as i64,
                    track.size_bytes as i64,
                    track.modified_epoch
                ],
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        let id = self
            .conn
            .query_row(
                "SELECT id FROM tracks WHERE path = ?1",
                params![track.path],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        Ok(TrackId(id as u64))
    }

    pub fn track_by_path(&self, path: &str) -> Result<Option<Track>, CoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, path, title, artist, album, genre, year, duration_ms, size_bytes, modified_epoch FROM tracks WHERE path = ?1")
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        let mut rows = stmt
            .query_map(params![path], row_to_track)
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        match rows.next() {
            Some(r) => r.map(Some).map_err(|e| CoreError::Storage(e.to_string())),
            None => Ok(None),
        }
    }

    pub fn track_by_id(&self, id: TrackId) -> Result<Track, CoreError> {
        self.conn
            .query_row(
                "SELECT id, path, title, artist, album, genre, year, duration_ms, size_bytes, modified_epoch FROM tracks WHERE id = ?1",
                params![id.0 as i64],
                row_to_track,
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => CoreError::TrackNotFound(id.0),
                e => CoreError::Storage(e.to_string()),
            })
    }

    pub fn all_tracks(&self) -> Result<Vec<Track>, CoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, path, title, artist, album, genre, year, duration_ms, size_bytes, modified_epoch FROM tracks ORDER BY id")
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        let rows = stmt
            .query_map([], row_to_track)
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| CoreError::Storage(e.to_string()))
    }

    // --- analyses ---

    /// Store (replacing any previous) analysis for a track.
    pub fn store_analysis(
        &mut self,
        track_id: TrackId,
        fv: &FeatureVector,
    ) -> Result<(), CoreError> {
        let blob = f32_slice_to_blob(&fv.values);
        self.conn
            .execute(
                "INSERT INTO analyses (track_id, algorithm_version, feature_vector_version, features, analyzed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(track_id) DO UPDATE SET
                     algorithm_version = excluded.algorithm_version,
                     feature_vector_version = excluded.feature_vector_version,
                     features = excluded.features,
                     analyzed_at = excluded.analyzed_at",
                params![
                    track_id.0 as i64,
                    fv.algorithm_version,
                    fv.feature_vector_version as i64,
                    blob,
                    now_epoch()
                ],
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        Ok(())
    }

    pub fn analysis_for(&self, track_id: TrackId) -> Result<FeatureVector, CoreError> {
        self.conn
            .query_row(
                "SELECT algorithm_version, feature_vector_version, features FROM analyses WHERE track_id = ?1",
                params![track_id.0 as i64],
                |r| {
                    let algorithm_version: String = r.get(0)?;
                    let version: i64 = r.get(1)?;
                    let blob: Vec<u8> = r.get(2)?;
                    Ok(FeatureVector {
                        algorithm_version,
                        feature_vector_version: version as u32,
                        values: blob_to_f32_vec(&blob),
                    })
                },
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => CoreError::AnalysisMissing(track_id.0),
                e => CoreError::Storage(e.to_string()),
            })
    }

    // --- classifications ---

    pub fn store_classification(
        &mut self,
        track_id: TrackId,
        axes: &ToneAxes,
        channels: &ChannelScores,
    ) -> Result<(), CoreError> {
        self.conn
            .execute(
                "INSERT INTO classifications (track_id, weights_version, axis_scores, channel_scores, classified_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(track_id) DO UPDATE SET
                     weights_version = excluded.weights_version,
                     axis_scores = excluded.axis_scores,
                     channel_scores = excluded.channel_scores,
                     classified_at = excluded.classified_at",
                params![
                    track_id.0 as i64,
                    axes.weights_version,
                    f32_slice_to_blob(&axes.scores),
                    f32_slice_to_blob(&channels.scores),
                    now_epoch()
                ],
            )
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        Ok(())
    }

    pub fn classification_for(
        &self,
        track_id: TrackId,
    ) -> Result<(ToneAxes, ChannelScores), CoreError> {
        self.conn
            .query_row(
                "SELECT weights_version, axis_scores, channel_scores FROM classifications WHERE track_id = ?1",
                params![track_id.0 as i64],
                |r| {
                    let weights_version: String = r.get(0)?;
                    let axis_blob: Vec<u8> = r.get(1)?;
                    let channel_blob: Vec<u8> = r.get(2)?;
                    Ok((
                        ToneAxes {
                            scores: blob_to_f32_array(&axis_blob),
                            weights_version: weights_version.clone(),
                        },
                        ChannelScores {
                            scores: blob_to_f32_array(&channel_blob),
                            weights_version,
                        },
                    ))
                },
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => CoreError::AnalysisMissing(track_id.0),
                e => CoreError::Storage(e.to_string()),
            })
    }
}

fn row_to_track(r: &rusqlite::Row<'_>) -> rusqlite::Result<Track> {
    Ok(Track {
        id: TrackId(r.get::<_, i64>(0)? as u64),
        path: r.get(1)?,
        title: r.get(2)?,
        artist: r.get(3)?,
        album: r.get(4)?,
        genre: r.get(5)?,
        year: r.get::<_, Option<i64>>(6)?.map(|y| y as u16),
        duration_ms: r.get::<_, i64>(7)? as u64,
        size_bytes: r.get::<_, i64>(8)? as u64,
        modified_epoch: r.get(9)?,
    })
}

fn f32_slice_to_blob(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

fn blob_to_f32_vec(blob: &[u8]) -> Vec<f32> {
    blob.as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

fn blob_to_f32_array<const N: usize>(blob: &[u8]) -> [f32; N] {
    let mut out = [0.0f32; N];
    for (slot, b) in out.iter_mut().zip(blob.as_chunks::<4>().0.iter()) {
        *slot = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
    }
    out
}

fn now_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_track(path: &str) -> Track {
        Track {
            id: TrackId(0),
            path: path.to_string(),
            title: Some("Test".into()),
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            genre: Some("Rock".into()),
            year: Some(2001),
            duration_ms: 183_000,
            size_bytes: 4_000_000,
            modified_epoch: 1_000_000,
        }
    }

    #[test]
    fn upsert_is_idempotent_and_stable() {
        let mut lib = Library::open_in_memory().unwrap();
        let a = lib.upsert_track(&sample_track("/m/a.mp3")).unwrap();
        let b = lib.upsert_track(&sample_track("/m/a.mp3")).unwrap();
        assert_eq!(a, b);
        assert_eq!(lib.all_tracks().unwrap().len(), 1);
    }

    #[test]
    fn track_roundtrip() {
        let mut lib = Library::open_in_memory().unwrap();
        let mut t = sample_track("/m/b.mp3");
        let id = lib.upsert_track(&t).unwrap();
        t.id = id;
        assert_eq!(lib.track_by_id(id).unwrap(), t);
        assert_eq!(lib.track_by_path("/m/b.mp3").unwrap().unwrap(), t);
        assert!(lib.track_by_path("/nope.mp3").unwrap().is_none());
    }

    #[test]
    fn analysis_roundtrip_preserves_exact_f32() {
        let mut lib = Library::open_in_memory().unwrap();
        let id = lib.upsert_track(&sample_track("/m/c.mp3")).unwrap();
        let fv = FeatureVector {
            algorithm_version: "0.1.0".into(),
            feature_vector_version: 1,
            values: vec![0.0, 0.5, 1.0, 0.3000001f32, 1e-12],
        };
        lib.store_analysis(id, &fv).unwrap();
        let got = lib.analysis_for(id).unwrap();
        assert_eq!(got, fv);
        // replace, not append
        lib.store_analysis(id, &fv).unwrap();
        assert_eq!(lib.analysis_for(id).unwrap(), fv);
    }

    #[test]
    fn missing_analysis_errors() {
        let mut lib = Library::open_in_memory().unwrap();
        let id = lib.upsert_track(&sample_track("/m/d.mp3")).unwrap();
        assert!(matches!(
            lib.analysis_for(id),
            Err(CoreError::AnalysisMissing(_))
        ));
    }

    #[test]
    fn classification_roundtrip() {
        let mut lib = Library::open_in_memory().unwrap();
        let id = lib.upsert_track(&sample_track("/m/e.mp3")).unwrap();
        let axes = ToneAxes {
            scores: [0.1; 12],
            weights_version: "0".into(),
        };
        let channels = ChannelScores {
            scores: [0.2; 13],
            weights_version: "0".into(),
        };
        lib.store_classification(id, &axes, &channels).unwrap();
        let (a, c) = lib.classification_for(id).unwrap();
        assert_eq!(a, axes);
        assert_eq!(c, channels);
    }
}
