//! Tone-axis scoring and channel mapping (ADR-011).
//!
//! Two stages: feature vector → 12 tone axes → 13 channel scores.
//! Classification is a pure function of (stored features, versioned weights):
//! it never re-decodes audio (AGENTS.md §2).
//!
//! v0 weights are hand-tuned from the feature layout semantics
//! (`sensme_audio::FEATURE_NAMES_V1`); they are a starting point to be
//! calibrated against benchmarks in Phase 3. Axis scores are clamped linear
//! combinations; channel scores are weighted averages of axis scores.

use thiserror::Error;

use sensme_core::models::{ChannelScores, FeatureVector, ToneAxes};

/// Version of the axis weight set. Bump on any semantic change (ADR-012).
pub const AXIS_WEIGHTS_VERSION: &str = "0.1.0";

/// Version of the channel mapping weight set.
pub const CHANNEL_WEIGHTS_VERSION: &str = "0.1.0";

/// Errors from classification.
#[derive(Debug, Error)]
pub enum ClassifyError {
    #[error("feature vector layout v{version} has {len} values, expected v1 with 30")]
    LayoutMismatch { version: u32, len: usize },
}

// Feature indices in the v1 layout (sensme_audio::FEATURE_NAMES_V1).
const BPM: usize = 0;
const TEMPO_STRENGTH: usize = 1;
const TEMPO_STABILITY: usize = 2;
const BEAT_STRENGTH: usize = 3;
const ONSET_RATE: usize = 4;
const RMS: usize = 6;
const CENTROID: usize = 9;
const LOW: usize = 13;
const HIGH: usize = 15;
const ZCR: usize = 16;
const VALENCE: usize = 17;
const HARMONIC: usize = 19;

/// One axis rule: `score = clamp01(bias + Σ wᵢ·xᵢ)`.
struct AxisRule {
    bias: f32,
    weights: &'static [(usize, f32)],
}

/// Axis rules, ordered to match [`sensme_core::models::TONE_AXES`].
const AXIS_RULES: [AxisRule; 12] = [
    // energetic: fast, loud, punchy, bright
    AxisRule {
        bias: -0.4,
        weights: &[
            (BPM, 1.2),
            (ONSET_RATE, 0.8),
            (RMS, 0.6),
            (BEAT_STRENGTH, 0.4),
            (HIGH, 0.4),
        ],
    },
    // excited: fast and bright (less weight on groove than energetic)
    AxisRule {
        bias: -0.5,
        weights: &[(BPM, 1.0), (ONSET_RATE, 0.8), (CENTROID, 0.8), (ZCR, 0.4)],
    },
    // groovy: steady strong beat, bass-forward
    AxisRule {
        bias: -0.3,
        weights: &[
            (TEMPO_STABILITY, 1.0),
            (BEAT_STRENGTH, 0.8),
            (LOW, 0.8),
            (BPM, 0.4),
        ],
    },
    // danceable: four-on-the-floor-ish: steady, beaty, bassy, moderate-fast
    AxisRule {
        bias: -0.5,
        weights: &[
            (BPM, 0.9),
            (TEMPO_STABILITY, 1.0),
            (BEAT_STRENGTH, 0.8),
            (LOW, 0.6),
        ],
    },
    // sensual: slow, bassy, harmonic, not scratchy
    AxisRule {
        bias: 0.0,
        weights: &[(BPM, -0.8), (LOW, 0.9), (HARMONIC, 0.7), (ZCR, -0.5)],
    },
    // sweet: major, harmonic, soft and dark-ish
    AxisRule {
        bias: -0.3,
        weights: &[
            (VALENCE, 1.2),
            (HARMONIC, 0.8),
            (CENTROID, -0.6),
            (RMS, -0.3),
        ],
    },
    // bittersweet: minor, harmonic (sad-but-pretty)
    AxisRule {
        bias: 0.3,
        weights: &[(VALENCE, -1.2), (HARMONIC, 0.7)],
    },
    // mellow: slow, quiet, dark, harmonic
    AxisRule {
        bias: 0.1,
        weights: &[(BPM, -0.8), (RMS, -0.6), (CENTROID, -0.8), (HARMONIC, 0.8)],
    },
    // dreamy: sustained, smooth, few transients, dark
    AxisRule {
        bias: -0.1,
        weights: &[
            (ONSET_RATE, -0.6),
            (ZCR, -0.6),
            (HARMONIC, 1.0),
            (CENTROID, -0.4),
        ],
    },
    // chillout: slow, sparse, quiet, harmonic
    AxisRule {
        bias: 0.0,
        weights: &[
            (BPM, -0.9),
            (ONSET_RATE, -0.8),
            (RMS, -0.5),
            (HARMONIC, 0.8),
        ],
    },
    // tough: minor, bassy, loud, driving
    AxisRule {
        bias: -0.3,
        weights: &[(VALENCE, -0.8), (LOW, 0.9), (RMS, 0.6), (BPM, 0.4)],
    },
    // aggressive: loud, bright, noisy (inharmonic), fast
    AxisRule {
        bias: -0.5,
        weights: &[
            (RMS, 0.8),
            (CENTROID, 1.0),
            (ZCR, 0.8),
            (HARMONIC, -0.8),
            (BPM, 0.8),
            (ONSET_RATE, 0.6),
        ],
    },
];

/// One channel rule: weighted average of axis scores.
struct ChannelRule {
    /// (axis index into TONE_AXES, weight)
    axes: &'static [(usize, f32)],
}

/// Channel rules, ordered to match [`Channel::ALL`].
///
/// Time-of-day channels carry only their tone profile here; the time-of-day
/// boost is applied at query time (ADR-011), keeping classification a pure
/// function of stored features.
const CHANNEL_RULES: [ChannelRule; 13] = [
    // Energetic
    ChannelRule {
        axes: &[(0, 1.0), (1, 0.6), (3, 0.4)],
    },
    // Relax
    ChannelRule {
        axes: &[(9, 1.0), (7, 0.8), (8, 0.5)],
    },
    // Upbeat
    ChannelRule {
        axes: &[(1, 0.8), (3, 0.8), (0, 0.6), (5, 0.4)],
    },
    // Mellow
    ChannelRule {
        axes: &[(7, 1.0), (8, 0.6), (9, 0.5)],
    },
    // Lounge
    ChannelRule {
        axes: &[(4, 0.8), (9, 0.7), (7, 0.6)],
    },
    // Emotional
    ChannelRule {
        axes: &[(6, 0.9), (5, 0.7), (8, 0.6)],
    },
    // Dance
    ChannelRule {
        axes: &[(3, 1.0), (0, 0.7), (2, 0.7)],
    },
    // Extreme
    ChannelRule {
        axes: &[(11, 1.0), (10, 0.7)],
    },
    // Morning
    ChannelRule {
        axes: &[(5, 0.8), (7, 0.6), (1, 0.4)],
    },
    // Daytime
    ChannelRule {
        axes: &[(1, 0.7), (2, 0.6), (3, 0.5)],
    },
    // Evening
    ChannelRule {
        axes: &[(4, 0.8), (2, 0.6), (6, 0.5)],
    },
    // Night
    ChannelRule {
        axes: &[(9, 0.8), (8, 0.7), (4, 0.5)],
    },
    // Midnight
    ChannelRule {
        axes: &[(8, 0.8), (9, 0.6), (10, 0.3)],
    },
];

fn clamp01(v: f32) -> f32 {
    v.clamp(0.0, 1.0)
}

/// Score the 12 tone axes from a v1 feature vector.
///
/// # Errors
/// [`ClassifyError::LayoutMismatch`] if the vector is not v1/30 values.
pub fn score_axes(features: &FeatureVector) -> Result<ToneAxes, ClassifyError> {
    check_layout(features)?;
    let mut x = features.values.clone();
    // v0 reliability gate: when the tempo estimate has no salience, the BPM
    // and beat-continuity features are noise — neutralize them.
    if x[TEMPO_STRENGTH] < 0.05 {
        x[BPM] = 0.5;
        x[TEMPO_STABILITY] = 0.0;
        x[BEAT_STRENGTH] = 0.0;
    }
    let mut scores = [0.0f32; 12];
    for (rule, out) in AXIS_RULES.iter().zip(scores.iter_mut()) {
        let mut s = rule.bias;
        for &(idx, w) in rule.weights {
            s += w * x[idx];
        }
        *out = clamp01(s);
    }
    Ok(ToneAxes {
        scores,
        weights_version: AXIS_WEIGHTS_VERSION.to_string(),
    })
}

/// Map tone axes to the 13 channel scores.
pub fn score_channels(axes: &ToneAxes) -> ChannelScores {
    let mut scores = [0.0f32; 13];
    for (rule, out) in CHANNEL_RULES.iter().zip(scores.iter_mut()) {
        let (mut acc, mut wsum) = (0.0f32, 0.0f32);
        for &(ax, w) in rule.axes {
            acc += w * axes.scores[ax];
            wsum += w;
        }
        *out = clamp01(acc / (wsum + f32::EPSILON));
    }
    ChannelScores {
        scores,
        weights_version: CHANNEL_WEIGHTS_VERSION.to_string(),
    }
}

/// Full classification: features → axes → channels.
///
/// # Errors
/// [`ClassifyError::LayoutMismatch`] if the vector is not v1/30 values.
pub fn classify(features: &FeatureVector) -> Result<(ToneAxes, ChannelScores), ClassifyError> {
    let axes = score_axes(features)?;
    let channels = score_channels(&axes);
    Ok((axes, channels))
}

fn check_layout(fv: &FeatureVector) -> Result<(), ClassifyError> {
    if fv.feature_vector_version != 1 || fv.values.len() != 30 {
        return Err(ClassifyError::LayoutMismatch {
            version: fv.feature_vector_version,
            len: fv.values.len(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sensme_core::models::Channel;

    use super::*;

    fn fv(values: [f32; 30]) -> FeatureVector {
        FeatureVector {
            algorithm_version: "0.1.0".into(),
            feature_vector_version: 1,
            values: values.to_vec(),
        }
    }

    /// Fast, loud, bright, noisy, inharmonic → aggressive profile.
    fn aggressive_fv() -> FeatureVector {
        let mut v = [0.5f32; 30];
        v[BPM] = 0.9;
        v[ONSET_RATE] = 0.9;
        v[RMS] = 0.95;
        v[CENTROID] = 0.8;
        v[ZCR] = 0.8;
        v[HARMONIC] = 0.2;
        v[VALENCE] = 0.2;
        fv(v)
    }

    /// Slow, quiet, dark, sustained, harmonic → mellow/chillout profile.
    fn mellow_fv() -> FeatureVector {
        let mut v = [0.3f32; 30];
        v[BPM] = 0.2;
        v[ONSET_RATE] = 0.05;
        v[RMS] = 0.3;
        v[CENTROID] = 0.15;
        v[ZCR] = 0.05;
        v[HARMONIC] = 0.95;
        v[VALENCE] = 0.6;
        fv(v)
    }

    #[test]
    fn aggressive_beats_mellow_on_extreme_channel() {
        let (axes, channels) = classify(&aggressive_fv()).unwrap();
        assert!(
            channels.score_for(Channel::Extreme) > channels.score_for(Channel::Mellow),
            "axes: {:?}",
            axes.scores
        );
        assert!(
            axes.scores[11] > 0.6,
            "aggressive axis: {}",
            axes.scores[11]
        );
    }

    #[test]
    fn mellow_beats_aggressive_on_relax_channel() {
        let (_, channels) = classify(&mellow_fv()).unwrap();
        assert!(channels.score_for(Channel::Relax) > channels.score_for(Channel::Extreme));
    }

    #[test]
    fn all_scores_in_range_and_finite() {
        for f in [aggressive_fv(), mellow_fv(), fv([0.0; 30]), fv([1.0; 30])] {
            let (axes, channels) = classify(&f).unwrap();
            assert!(axes.scores.iter().all(|v| (0.0..=1.0).contains(v)));
            assert!(channels.scores.iter().all(|v| (0.0..=1.0).contains(v)));
        }
    }

    #[test]
    fn classification_is_deterministic() {
        let a = classify(&aggressive_fv()).unwrap();
        let b = classify(&aggressive_fv()).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn wrong_layout_is_rejected() {
        let mut f = aggressive_fv();
        f.values.pop();
        assert!(matches!(
            classify(&f),
            Err(ClassifyError::LayoutMismatch { .. })
        ));
        let mut g = aggressive_fv();
        g.feature_vector_version = 2;
        assert!(matches!(
            classify(&g),
            Err(ClassifyError::LayoutMismatch { .. })
        ));
    }

    #[test]
    fn unreliable_tempo_does_not_produce_dance_confidence() {
        // pure-tone profile: no rhythm salience (strength ~0), spurious bpm
        let mut v = [0.3f32; 30];
        v[BPM] = 0.83;
        v[TEMPO_STRENGTH] = 0.0002;
        v[TEMPO_STABILITY] = 1.0;
        v[RMS] = 0.9;
        v[HARMONIC] = 0.99;
        let (_, channels) = classify(&fv(v)).unwrap();
        assert!(
            channels.score_for(Channel::Dance) < 0.5,
            "dance: {}",
            channels.score_for(Channel::Dance)
        );
    }

    #[test]
    fn versions_are_semver_like() {
        assert!(AXIS_WEIGHTS_VERSION.matches('.').count() == 2);
        assert!(CHANNEL_WEIGHTS_VERSION.matches('.').count() == 2);
    }
}

#[cfg(test)]
mod axis_response_tests {
    use super::*;
    use sensme_core::models::Channel;

    /// Score every axis with one feature swept 0→1 (tempo kept reliable).
    fn delta(axis: usize, feature: usize) -> f32 {
        let mut v = [0.5f32; 30];
        v[TEMPO_STRENGTH] = 0.5;
        let mut lo = v;
        lo[feature] = 0.0;
        let mut hi = v;
        hi[feature] = 1.0;
        let mk = |x: [f32; 30]| FeatureVector {
            algorithm_version: "t".into(),
            feature_vector_version: 1,
            values: x.to_vec(),
        };
        let s_lo = score_axes(&mk(lo)).unwrap().scores[axis];
        let s_hi = score_axes(&mk(hi)).unwrap().scores[axis];
        s_hi - s_lo
    }

    macro_rules! responds {
        ($name:ident, $axis:expr, $feat:expr, $positive:expr) => {
            #[test]
            fn $name() {
                let axis_idx = $axis;
                let d = delta($axis, $feat);
                if $positive {
                    assert!(d > 0.05, "axis {axis_idx} delta {d} should be positive");
                } else {
                    assert!(d < -0.05, "axis {axis_idx} delta {d} should be negative");
                }
            }
        };
    }

    responds!(energetic_speed, 0, BPM, true);
    responds!(excited_onsets, 1, ONSET_RATE, true);
    responds!(groovy_stability, 2, TEMPO_STABILITY, true);
    responds!(danceable_bass, 3, LOW, true);
    responds!(sensual_bass, 4, LOW, true);
    responds!(sweet_major, 5, VALENCE, true);
    responds!(bittersweet_minor, 6, VALENCE, false);
    responds!(dreamy_harmonic, 8, HARMONIC, true);
    responds!(tough_loud, 10, RMS, true);
    responds!(aggressive_bright, 11, CENTROID, true);

    #[test]
    fn mellow_dark_and_sparse_respond_in_the_right_direction() {
        // soft, slow, harmonic base where both axes sit in the linear range
        let mut v = [0.2f32; 30];
        v[TEMPO_STRENGTH] = 0.5;
        v[HARMONIC] = 0.9;
        let mk = |centroid: f32, onset: f32| {
            let mut x = v;
            x[CENTROID] = centroid;
            x[ONSET_RATE] = onset;
            score_axes(&FeatureVector {
                algorithm_version: "t".into(),
                feature_vector_version: 1,
                values: x.to_vec(),
            })
            .unwrap()
            .scores
        };
        let dark = mk(0.0, 0.0);
        let bright = mk(1.0, 0.0);
        assert!(dark[7] > bright[7] + 0.1, "mellow should prefer dark");
        let sparse = mk(0.0, 0.0);
        let busy = mk(0.0, 1.0);
        assert!(sparse[9] > busy[9] + 0.1, "chillout should prefer sparse");
    }

    #[test]
    fn every_channel_reachable() {
        // each channel must score positively for at least one of the two
        // opposite reference profiles
        let mut ag = [0.5f32; 30];
        ag[BPM] = 0.9;
        ag[ONSET_RATE] = 0.9;
        ag[RMS] = 0.95;
        ag[CENTROID] = 0.8;
        ag[ZCR] = 0.8;
        ag[HARMONIC] = 0.2;
        ag[VALENCE] = 0.2;
        let mut ml = [0.3f32; 30];
        ml[BPM] = 0.2;
        ml[ONSET_RATE] = 0.05;
        ml[RMS] = 0.3;
        ml[CENTROID] = 0.15;
        ml[ZCR] = 0.05;
        ml[HARMONIC] = 0.95;
        ml[VALENCE] = 0.6;
        let mk = |v: [f32; 30]| FeatureVector {
            algorithm_version: "t".into(),
            feature_vector_version: 1,
            values: v.to_vec(),
        };
        let (_, a) = classify(&mk(ag)).unwrap();
        let (_, m) = classify(&mk(ml)).unwrap();
        for ch in Channel::ALL {
            assert!(
                a.score_for(ch) > 0.0 || m.score_for(ch) > 0.0,
                "channel {ch:?} unreachable"
            );
        }
    }
}
