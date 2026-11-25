//! Tone-axis scoring and channel mapping (ADR-011).
//!
//! Two stages: feature vector → 12 tone axes → 13 channel scores.
//! Classification is a pure function of (stored features, versioned weights):
//! it never re-decodes audio (AGENTS.md §2).
//!
//! Implementation lands in Phase 2 (v0 hand-tuned weights); calibration in
//! Phase 3 via sensme-bench.

use sensme_core::error::CoreError;
use sensme_core::models::{ChannelScores, FeatureVector, ToneAxes};

/// Version of the axis weight set. Bump on any semantic change (ADR-012).
pub const AXIS_WEIGHTS_VERSION: &str = "0.0.0";

/// Version of the channel mapping weight set.
pub const CHANNEL_WEIGHTS_VERSION: &str = "0.0.0";

/// Score the 12 tone axes from a feature vector.
///
/// # Errors
/// [`CoreError::NotImplemented`] until Phase 2.
pub fn score_axes(_features: &FeatureVector) -> Result<ToneAxes, CoreError> {
    // TODO(phase-2): axis scoring v0 with hand-tuned weights.
    Err(CoreError::NotImplemented {
        phase: "phase 2",
        what: "tone-axis scoring",
    })
}

/// Map tone axes (+ time-of-day context) to the 13 channel scores.
///
/// # Errors
/// [`CoreError::NotImplemented`] until Phase 2.
pub fn score_channels(_axes: &ToneAxes) -> Result<ChannelScores, CoreError> {
    // TODO(phase-2): channel mapping v0.
    Err(CoreError::NotImplemented {
        phase: "phase 2",
        what: "channel scoring",
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn versions_are_semver_like() {
        assert!(super::AXIS_WEIGHTS_VERSION.matches('.').count() == 2);
        assert!(super::CHANNEL_WEIGHTS_VERSION.matches('.').count() == 2);
    }
}
