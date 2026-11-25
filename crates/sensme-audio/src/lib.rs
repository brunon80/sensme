//! Audio decoding, resampling, STFT, and feature extraction.
//!
//! Pipeline design: see docs/ARCHITECTURE.md §3. Decode (symphonia) → mono
//! 22 050 Hz (rubato, ADR-015) → shared STFT (rustfft) → feature extractors.
//! This crate is free of C dependencies and platform-native DSP (AGENTS.md §2).

pub mod audio;
pub mod chroma;
pub mod features;
pub mod hpss;
pub mod mfcc;
pub mod onset;
pub mod spectral;
pub mod stft;
pub mod tempo;

pub use audio::{load_mono, Audio, AudioError};
pub use features::ANALYSIS_RATE;

/// Version of the analysis pipeline. Bump on any semantic change (ADR-012).
pub const ALGORITHM_VERSION: &str = "0.1.0";

/// Layout version of [`sensme_core::models::FeatureVector::values`].
/// Bump on any layout change.
pub const FEATURE_VECTOR_VERSION: u32 = 1;

/// Decode a file and extract the versioned feature vector.
///
/// # Errors
/// [`AudioError`] on IO/decode/resample failure. Individual corrupt packets
/// are skipped.
pub fn analyze_file(path: &str) -> Result<sensme_core::models::FeatureVector, AudioError> {
    let audio = load_mono(path, ANALYSIS_RATE)?;
    Ok(features::extract(&audio))
}

/// Extract the versioned feature vector from already-decoded mono audio
/// (used by the bench dataset generator; same pipeline as [`analyze_file`]).
pub fn analyze_audio(audio: &Audio) -> sensme_core::models::FeatureVector {
    features::extract(audio)
}
