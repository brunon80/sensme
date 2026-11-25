//! Audio decoding, resampling, STFT, and feature extraction.
//!
//! Pipeline design: see docs/ARCHITECTURE.md §3. Decode (symphonia) → mono
//! 22 050 Hz (rubato, ADR-015) → shared STFT (rustfft) → feature extractors.
//!
//! Implementation lands in Phase 2. This crate must stay free of C
//! dependencies and platform-native DSP (AGENTS.md §2).

use sensme_core::error::CoreError;
use sensme_core::models::FeatureVector;

/// Version of the analysis pipeline. Bump on any semantic change (ADR-012).
pub const ALGORITHM_VERSION: &str = "0.0.0";

/// Layout version of [`FeatureVector::values`]. Bump on any layout change.
pub const FEATURE_VECTOR_VERSION: u32 = 0;

/// Analyze one audio file into a versioned feature vector.
///
/// # Errors
/// [`CoreError::NotImplemented`] until Phase 2; afterwards, decode/IO errors.
pub fn analyze_file(_path: &str) -> Result<FeatureVector, CoreError> {
    // TODO(phase-2): real implementation (decode → STFT → extractors).
    Err(CoreError::NotImplemented {
        phase: "phase 2",
        what: "audio analysis",
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn versions_are_semver_like() {
        assert!(super::ALGORITHM_VERSION.matches('.').count() == 2);
    }
}
