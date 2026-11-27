//! Benchmark dataset loading and validation (docs/BENCHMARK_FORMAT.md).

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use moodwave_core::models::{Channel, FeatureVector};

/// Current on-disk format version.
pub const DATASET_FORMAT_VERSION: u32 = 1;

/// One labeled track: either a stored v1 feature vector (preferred) or an
/// audio path analyzed at bench time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackRecord {
    pub id: String,
    #[serde(default)]
    pub features: Option<FeatureVector>,
    /// Path relative to the repository root; analyzed at bench time when
    /// `features` is absent.
    #[serde(default)]
    pub audio: Option<String>,
    /// Channel id → membership. Channels absent here are excluded from
    /// this track's metrics.
    pub labels: BTreeMap<String, bool>,
}

/// A reference-label dataset. Provenance is mandatory (AGENTS.md §4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dataset {
    pub format_version: u32,
    pub name: String,
    pub created: String,
    pub provenance: String,
    pub label_scale: String,
    pub tracks: Vec<TrackRecord>,
}

impl Dataset {
    /// Load and validate a dataset JSON file.
    ///
    /// # Errors
    /// [`BenchError`] on IO/parse failure or format violations (missing
    /// provenance, unknown channel ids, tracks without features/audio).
    pub fn load(path: impl AsRef<Path>) -> Result<Dataset, BenchError> {
        let text = std::fs::read_to_string(path.as_ref())
            .map_err(|e| BenchError::Io(format!("{}: {e}", path.as_ref().display())))?;
        let ds: Dataset = serde_json::from_str(&text)
            .map_err(|e| BenchError::Parse(format!("{}: {e}", path.as_ref().display())))?;
        ds.validate()?;
        Ok(ds)
    }

    /// Format validation per docs/BENCHMARK_FORMAT.md.
    ///
    /// # Errors
    /// [`BenchError::Invalid`] on any rule violation.
    pub fn validate(&self) -> Result<(), BenchError> {
        if self.format_version != DATASET_FORMAT_VERSION {
            return Err(BenchError::Invalid(format!(
                "unsupported format_version {} (expected {})",
                self.format_version, DATASET_FORMAT_VERSION
            )));
        }
        if self.provenance.trim().is_empty() {
            return Err(BenchError::Invalid("provenance is mandatory".to_string()));
        }
        if self.label_scale != "binary" {
            return Err(BenchError::Invalid(format!(
                "label_scale {:?} not supported (only \"binary\")",
                self.label_scale
            )));
        }
        let valid: Vec<&str> = Channel::ALL.iter().map(|c| c.id()).collect();
        for t in &self.tracks {
            if t.features.is_none() && t.audio.is_none() {
                return Err(BenchError::Invalid(format!(
                    "track {} has neither features nor audio",
                    t.id
                )));
            }
            for k in t.labels.keys() {
                if !valid.contains(&k.as_str()) {
                    return Err(BenchError::Invalid(format!(
                        "track {} has unknown channel label {k:?}",
                        t.id
                    )));
                }
            }
        }
        Ok(())
    }
}

/// Errors for dataset loading, evaluation and calibration.
#[derive(Debug, thiserror::Error)]
pub enum BenchError {
    #[error("io error: {0}")]
    Io(String),
    #[error("parse error: {0}")]
    Parse(String),
    #[error("invalid dataset: {0}")]
    Invalid(String),
    #[error("analysis error: {0}")]
    Analysis(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ds() -> Dataset {
        Dataset {
            format_version: 1,
            name: "t".into(),
            created: "2026-11-25".into(),
            provenance: "test".into(),
            label_scale: "binary".into(),
            tracks: vec![TrackRecord {
                id: "a".into(),
                features: Some(FeatureVector {
                    algorithm_version: "0.1.0".into(),
                    feature_vector_version: 1,
                    values: vec![0.5; 30],
                }),
                audio: None,
                labels: BTreeMap::from([("dance".to_string(), true)]),
            }],
        }
    }

    #[test]
    fn valid_dataset_passes() {
        ds().validate().unwrap();
    }

    #[test]
    fn missing_provenance_rejected() {
        let mut d = ds();
        d.provenance = "  ".into();
        assert!(matches!(d.validate(), Err(BenchError::Invalid(_))));
    }

    #[test]
    fn unknown_channel_label_rejected() {
        let mut d = ds();
        d.tracks[0].labels = BTreeMap::from([("happy".to_string(), true)]);
        assert!(matches!(d.validate(), Err(BenchError::Invalid(_))));
    }

    #[test]
    fn track_without_features_or_audio_rejected() {
        let mut d = ds();
        d.tracks[0].features = None;
        assert!(matches!(d.validate(), Err(BenchError::Invalid(_))));
    }

    #[test]
    fn bad_format_version_rejected() {
        let mut d = ds();
        d.format_version = 99;
        assert!(matches!(d.validate(), Err(BenchError::Invalid(_))));
    }

    #[test]
    fn roundtrips_through_json() {
        let text = serde_json::to_string(&ds()).unwrap();
        let back: Dataset = serde_json::from_str(&text).unwrap();
        back.validate().unwrap();
        assert_eq!(back.tracks.len(), 1);
    }
}
