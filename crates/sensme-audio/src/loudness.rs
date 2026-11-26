//! Per-track loudness measurement + Dynamic Normalizer gain (ADR-018).
//!
//! Reverse-engineering the original PSP feature (see the RE report referenced
//! in ADR-018) recovered the *contract* — a per-track loudness scalar feeding
//! a playback gain, ON/OFF setting defaulting to ON, gain changes ramped over
//! the mixer's 71 ms interval — but the audible algorithm itself lives inside
//! Sony's closed firmware codec libraries and is not recoverable. The
//! measurement and gain mapping below are therefore a clean-room design,
//! versioned like everything else.

use serde::{Deserialize, Serialize};

/// Version of the loudness measurement + gain mapping. Bump on any semantic
/// change (ADR-012 discipline).
pub const LOUDNESS_VERSION: u32 = 1;

/// Target RMS the normalizer steers every track toward (normalized amplitude,
/// −1..=1). ≈ −20 dBFS: a comfortable pop/rock-era average loudness without
/// a loudness-war squeeze.
pub const TARGET_RMS: f32 = 0.10;

/// Post-gain peak ceiling (normalized amplitude). Keeps the output inside the
/// headroom browsers handle cleanly; never a hard limiter, just a cap on the
/// static gain.
pub const PEAK_CEILING: f32 = 0.99;

/// Static-gain bounds: at most ≈ −14 dB cut / ≈ +9.5 dB boost, so quiet
/// passages never pump and near-silent tracks never get slammed up.
pub const MIN_GAIN: f32 = 0.2;
pub const MAX_GAIN: f32 = 3.0;

/// Tracks quieter than this RMS are treated as silence: gain stays 1.0 so we
/// never amplify a blank or near-blank recording.
pub const SILENCE_FLOOR_RMS: f32 = 1e-4;

/// Per-track loudness measured on decoded mono `f32` samples (−1..=1).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Loudness {
    /// True peak absolute amplitude, 0.0–1.0 normalized.
    pub peak: f32,
    /// Root-mean-square amplitude over all measured samples, 0.0–1.0
    /// normalized.
    pub rms: f32,
}

/// Measure peak + RMS over mono normalized samples. Deterministic `f32`
/// accumulation in sample order (AGENTS §2: identical across platforms).
///
/// Empty input yields `peak = rms = 0.0`.
#[must_use]
pub fn measure(samples: &[f32]) -> Loudness {
    let mut peak = 0.0f32;
    let mut sum_sq = 0.0f64; // f64 accumulator: avoids order-sensitive drift on long tracks
    for &s in samples {
        let a = s.abs();
        if a > peak {
            peak = a;
        }
        sum_sq += f64::from(s) * f64::from(s);
    }
    let rms = if samples.is_empty() {
        0.0
    } else {
        (sum_sq / samples.len() as f64).sqrt() as f32
    };
    Loudness { peak, rms }
}

/// Static playback gain for the Dynamic Normalizer (ADR-018, clean-room).
///
/// Strategy: scale RMS to [`TARGET_RMS`], clamp to [`MIN_GAIN`]/[`MAX_GAIN`],
/// then cap so the post-gain peak stays under [`PEAK_CEILING`] (no clipping).
/// Near-silent tracks (RMS < [`SILENCE_FLOOR_RMS`]) keep unity gain.
///
/// Deterministic pure function of the stored [`Loudness`] — re-classification
/// never needs the audio (AGENTS §2).
#[must_use]
pub fn normalizer_gain(l: &Loudness) -> f32 {
    if l.rms < SILENCE_FLOOR_RMS {
        return 1.0;
    }
    let mut g = TARGET_RMS / l.rms;
    if g < MIN_GAIN {
        g = MIN_GAIN;
    }
    if g > MAX_GAIN {
        g = MAX_GAIN;
    }
    if l.peak > 0.0 {
        let ceiling = PEAK_CEILING / l.peak;
        if g > ceiling {
            g = ceiling;
        }
    }
    if g < 0.0 {
        g = 0.0;
    }
    g
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, amp: f32, n: usize, rate: f32) -> Vec<f32> {
        (0..n)
            .map(|i| amp * (2.0 * std::f32::consts::PI * freq * i as f32 / rate).sin())
            .collect()
    }

    #[test]
    fn measure_sine_peak_and_rms() {
        let s = sine(440.0, 0.5, 44_100, 44_100.0);
        let l = measure(&s);
        assert!((l.peak - 0.5).abs() < 1e-3, "peak {}", l.peak);
        let expect = 0.5 / std::f32::consts::SQRT_2;
        assert!((l.rms - expect).abs() < 1e-3, "rms {}", l.rms);
    }

    #[test]
    fn measure_empty_is_zero() {
        let l = measure(&[]);
        assert_eq!(l.peak, 0.0);
        assert_eq!(l.rms, 0.0);
    }

    #[test]
    fn silence_keeps_unity_gain() {
        assert_eq!(
            normalizer_gain(&Loudness {
                peak: 0.0,
                rms: 0.0
            }),
            1.0
        );
        assert_eq!(
            normalizer_gain(&Loudness {
                peak: 1e-5,
                rms: 1e-6
            }),
            1.0
        );
    }

    #[test]
    fn loud_track_is_cut() {
        // rms ≈ 0.354 → raw gain ≈ 0.283 (within bounds, peak ceiling 1.98).
        let g = normalizer_gain(&Loudness {
            peak: 0.5,
            rms: 0.354,
        });
        assert!((g - 0.1 / 0.354).abs() < 1e-4, "gain {g}");
    }

    #[test]
    fn quiet_track_is_boosted_up_to_max() {
        let g = normalizer_gain(&Loudness {
            peak: 0.01,
            rms: 0.007,
        });
        assert!((g - MAX_GAIN).abs() < 1e-6, "gain {g}");
    }

    #[test]
    fn peak_ceiling_prevents_clipping_boost() {
        // Sparse full-scale clicks: low rms wants a big boost, but the peak
        // ceiling must cap the gain just under PEAK_CEILING/peak.
        let g = normalizer_gain(&Loudness {
            peak: 1.0,
            rms: 0.02,
        });
        assert!((g - PEAK_CEILING).abs() < 1e-6, "gain {g}");
    }

    #[test]
    fn extreme_loud_is_cut_up_to_min() {
        let g = normalizer_gain(&Loudness {
            peak: 1.0,
            rms: 0.9,
        });
        assert!((g - MIN_GAIN).abs() < 1e-6, "gain {g}");
    }

    #[test]
    fn gain_is_deterministic_across_calls() {
        let s = sine(997.0, 0.31, 22_050, 22_050.0);
        let a = normalizer_gain(&measure(&s));
        let b = normalizer_gain(&measure(&s));
        assert_eq!(a.to_bits(), b.to_bits());
    }
}
