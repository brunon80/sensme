//! Library scanning: walk a directory tree, read tags/duration with lofty,
//! and upsert track rows. Files whose size and mtime are unchanged since the
//! stored row are skipped (cheap rescan).

use std::path::Path;

use lofty::prelude::*;

use crate::error::CoreError;
use crate::models::{Track, TrackId};
use crate::storage::Library;

/// Scan outcome counters.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ScanStats {
    pub added: usize,
    pub updated: usize,
    pub unchanged: usize,
    /// Files that could not be read or parsed.
    pub skipped: usize,
}

/// Extensions treated as audio. Mirrors the symphonia `all` feature set.
pub const AUDIO_EXTENSIONS: [&str; 7] = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"];

/// Scan `root` recursively and update the library.
///
/// # Errors
/// [`CoreError`] on storage failure or unreadable `root`.
pub fn scan_directory(lib: &mut Library, root: &Path) -> Result<ScanStats, CoreError> {
    if !root.is_dir() {
        return Err(CoreError::Storage(format!(
            "not a directory: {}",
            root.display()
        )));
    }
    let mut stats = ScanStats::default();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| CoreError::Storage(format!("{}: {e}", dir.display())))?;
        for entry in entries {
            let entry = entry.map_err(|e| CoreError::Storage(e.to_string()))?;
            let path = entry.path();
            let ft = entry
                .file_type()
                .map_err(|e| CoreError::Storage(e.to_string()))?;
            if ft.is_dir() {
                stack.push(path);
                continue;
            }
            if !is_audio_file(&path) {
                continue;
            }
            match scan_one(lib, &path) {
                Ok(ScanOutcome::Added) => stats.added += 1,
                Ok(ScanOutcome::Updated) => stats.updated += 1,
                Ok(ScanOutcome::Unchanged) => stats.unchanged += 1,
                Err(_) => stats.skipped += 1,
            }
        }
    }
    Ok(stats)
}

enum ScanOutcome {
    Added,
    Updated,
    Unchanged,
}

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn scan_one(lib: &mut Library, path: &Path) -> Result<ScanOutcome, CoreError> {
    let meta = std::fs::metadata(path).map_err(|e| CoreError::Storage(e.to_string()))?;
    let size_bytes = meta.len();
    let modified_epoch = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let path_str = path.to_string_lossy().into_owned();

    if let Some(existing) = lib.track_by_path(&path_str)? {
        if existing.size_bytes == size_bytes && existing.modified_epoch == modified_epoch {
            return Ok(ScanOutcome::Unchanged);
        }
    }

    let tagged = lofty::read_from_path(path)
        .map_err(|e| CoreError::Storage(format!("{}: {e}", path.display())))?;
    let duration_ms = tagged.properties().duration().as_millis() as u64;

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let track = Track {
        id: TrackId(0),
        path: path_str,
        title: tag.and_then(|t| t.title()).map(Into::into),
        artist: tag.and_then(|t| t.artist()).map(Into::into),
        album: tag.and_then(|t| t.album()).map(Into::into),
        genre: tag.and_then(|t| t.genre()).map(Into::into),
        year: tag.and_then(|t| t.date()).map(|d| d.year),
        duration_ms,
        size_bytes,
        modified_epoch,
    };
    let existed = lib.track_by_path(&track.path)?.is_some();
    lib.upsert_track(&track)?;
    Ok(if existed {
        ScanOutcome::Updated
    } else {
        ScanOutcome::Added
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fresh scratch dir under the platform temp dir, unique per test: CI
    /// runners have no `/tmp/opencode`, and parallel tests must not collide.
    fn scratch_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("sensme-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    /// Minimal mono PCM16 WAV writer for tests.
    fn write_wav(path: &Path, rate: usize, samples: &[f32]) {
        let data_len = (samples.len() * 2) as u32;
        let mut bytes: Vec<u8> = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&(rate as u32).to_le_bytes());
        bytes.extend_from_slice(&((rate * 2) as u32).to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        std::fs::write(path, bytes).expect("write wav");
    }

    #[test]
    fn scan_finds_audio_and_skips_unchanged() {
        let dir = scratch_dir("scan-test");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        let sine: Vec<f32> = (0..4410)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 44100.0).sin() * 0.5)
            .collect();
        write_wav(&dir.join("a.wav"), 44_100, &sine);
        write_wav(&dir.join("sub/b.wav"), 44_100, &sine);
        std::fs::write(dir.join("notes.txt"), "not audio").unwrap();

        let mut lib = Library::open_in_memory().unwrap();
        let stats = scan_directory(&mut lib, &dir).unwrap();
        assert_eq!(
            (stats.added, stats.updated, stats.unchanged, stats.skipped),
            (2, 0, 0, 0)
        );
        let tracks = lib.all_tracks().unwrap();
        assert_eq!(tracks.len(), 2);
        assert!(tracks.iter().all(|t| t.duration_ms > 0));

        // second pass: everything unchanged
        let stats2 = scan_directory(&mut lib, &dir).unwrap();
        assert_eq!((stats2.added, stats2.unchanged), (0, 2));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod extra_tests {
    use super::*;

    /// Fresh scratch dir under the platform temp dir, unique per test (see
    /// the `tests` module: CI runners have no `/tmp/opencode`).
    fn scratch_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("sensme-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    fn write_wav(path: &Path, rate: usize, n: usize) {
        let samples: Vec<f32> = (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / rate as f32).sin() * 0.5)
            .collect();
        let data_len = (samples.len() * 2) as u32;
        let mut bytes: Vec<u8> = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&(rate as u32).to_le_bytes());
        bytes.extend_from_slice(&((rate * 2) as u32).to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for s in &samples {
            let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        std::fs::write(path, bytes).expect("write wav");
    }

    #[test]
    fn modified_file_is_reported_as_updated() {
        let dir = scratch_dir("scan-upd");
        let f = dir.join("a.wav");
        write_wav(&f, 44_100, 4410);
        let mut lib = Library::open_in_memory().unwrap();
        assert_eq!(scan_directory(&mut lib, &dir).unwrap().added, 1);
        // rewrite with different size -> size change detected
        write_wav(&f, 44_100, 8820);
        let stats = scan_directory(&mut lib, &dir).unwrap();
        assert_eq!((stats.updated, stats.added), (1, 0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn uppercase_extension_is_accepted() {
        let dir = scratch_dir("scan-case");
        write_wav(&dir.join("A.WAV"), 44_100, 4410);
        let mut lib = Library::open_in_memory().unwrap();
        assert_eq!(scan_directory(&mut lib, &dir).unwrap().added, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
