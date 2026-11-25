//! UniFFI bindings surface for SensMe shells (ADR-007).
//!
//! This crate is a thin translation layer: it exposes the same operations as
//! the Rust crates with FFI-safe records. All logic stays in `sensme-audio`,
//! `sensme-classify` and `sensme-core` (AGENTS.md §2: shells never contain
//! business logic).

use sensme_core::models::{Channel, FeatureVector, TONE_AXES};

uniffi::setup_scaffolding!("sensme_ffi");

/// Errors surfaced to shells.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum FfiError {
    #[error("analysis failed: {detail}")]
    Analysis { detail: String },
    #[error("classification failed: {detail}")]
    Classification { detail: String },
}

/// Versioned feature vector crossing the FFI boundary.
#[derive(uniffi::Record)]
pub struct FfiFeatureVector {
    pub algorithm_version: String,
    pub feature_vector_version: u32,
    /// Ordered per `sensme_audio::FEATURE_NAMES_V1`.
    pub values: Vec<f32>,
}

/// Tone-axis + channel scores for one track.
#[derive(uniffi::Record)]
pub struct FfiClassification {
    /// Axis scores, ordered to match `axis_names`.
    pub axis_scores: Vec<f32>,
    pub axis_names: Vec<String>,
    /// Channel scores, ordered to match `channel_ids`.
    pub channel_scores: Vec<f32>,
    pub channel_ids: Vec<String>,
    pub weights_version: String,
}

/// Analyze + classify result bundle.
#[derive(uniffi::Record)]
pub struct FfiAnalysisResult {
    pub features: FfiFeatureVector,
    pub classification: FfiClassification,
}

fn to_ffi(fv: &FeatureVector) -> FfiFeatureVector {
    FfiFeatureVector {
        algorithm_version: fv.algorithm_version.clone(),
        feature_vector_version: fv.feature_vector_version,
        values: fv.values.clone(),
    }
}

fn to_classification(
    axes: &sensme_core::models::ToneAxes,
    channels: &sensme_core::models::ChannelScores,
) -> FfiClassification {
    FfiClassification {
        axis_scores: axes.scores.to_vec(),
        axis_names: TONE_AXES.iter().map(|s| (*s).to_string()).collect(),
        channel_scores: channels.scores.to_vec(),
        channel_ids: Channel::ALL.iter().map(|c| c.id().to_string()).collect(),
        weights_version: axes.weights_version.clone(),
    }
}

/// Decode + analyze one audio file; returns its versioned feature vector.
///
/// # Errors
/// [`FfiError::Analysis`] when the file cannot be decoded or analyzed.
#[uniffi::export]
pub fn analyze_file(path: String) -> Result<FfiFeatureVector, FfiError> {
    sensme_audio::analyze_file(&path)
        .map(|fv| to_ffi(&fv))
        .map_err(|e| FfiError::Analysis {
            detail: e.to_string(),
        })
}

/// Classify a stored feature vector (pure function; never re-decodes).
///
/// # Errors
/// [`FfiError::Classification`] when the vector layout is not v1.
#[uniffi::export]
pub fn classify_features(fv: FfiFeatureVector) -> Result<FfiClassification, FfiError> {
    let inner = FeatureVector {
        algorithm_version: fv.algorithm_version,
        feature_vector_version: fv.feature_vector_version,
        values: fv.values,
    };
    let (axes, channels) =
        sensme_classify::classify(&inner).map_err(|e| FfiError::Classification {
            detail: e.to_string(),
        })?;
    Ok(to_classification(&axes, &channels))
}

/// Convenience for shells: analyze + classify in one call.
///
/// # Errors
/// Propagates [`FfiError::Analysis`] / [`FfiError::Classification`].
#[uniffi::export]
pub fn analyze_and_classify(path: String) -> Result<FfiAnalysisResult, FfiError> {
    let fv = sensme_audio::analyze_file(&path).map_err(|e| FfiError::Analysis {
        detail: e.to_string(),
    })?;
    let (axes, channels) =
        sensme_classify::classify(&fv).map_err(|e| FfiError::Classification {
            detail: e.to_string(),
        })?;
    Ok(FfiAnalysisResult {
        features: to_ffi(&fv),
        classification: to_classification(&axes, &channels),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analyze_and_classify_wav_roundtrip() {
        // reuse the formats fixture (3 s 440 Hz tone)
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/formats/tone.wav"
        );
        let res = analyze_and_classify(path.to_string()).unwrap();
        let fv = &res.features;
        let cls = &res.classification;
        assert_eq!(fv.feature_vector_version, 1);
        assert_eq!(fv.values.len(), 30);
        assert_eq!(cls.axis_scores.len(), 12);
        assert_eq!(cls.channel_scores.len(), 13);
        assert_eq!(cls.axis_names.len(), 12);
        assert_eq!(cls.channel_ids.len(), 13);
        assert!(cls.axis_scores.iter().all(|v| (0.0..=1.0).contains(v)));
    }

    #[test]
    fn classify_rejects_bad_layout() {
        let bad = FfiFeatureVector {
            algorithm_version: "0.1.0".into(),
            feature_vector_version: 9,
            values: vec![0.5; 30],
        };
        assert!(matches!(
            classify_features(bad),
            Err(FfiError::Classification { .. })
        ));
    }

    #[test]
    fn analyze_missing_file_errors() {
        assert!(matches!(
            analyze_file("/tmp/opencode/definitely-missing.wav".into()),
            Err(FfiError::Analysis { .. })
        ));
    }
}
