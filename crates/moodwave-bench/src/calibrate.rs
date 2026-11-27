//! Weight calibration: coordinate search over axis/channel weights,
//! scored by macro F1 on a bench dataset, with a v0→tuned delta report
//! (AGENTS.md §4: every classifier change reports bench deltas).

use moodwave_classify::{AxisWeights, ChannelWeights};
use moodwave_core::models::FeatureVector;

use crate::dataset::{BenchError, Dataset};
use crate::metrics::{evaluate, BenchReport};

/// Outcome of a calibration run.
#[derive(Debug, Clone)]
pub struct CalibrationResult {
    pub axis_weights: AxisWeights,
    pub channel_weights: ChannelWeights,
    pub baseline: BenchReport,
    pub tuned: BenchReport,
}

fn macro_f1(dataset: &Dataset, aw: &AxisWeights, cw: &ChannelWeights) -> Result<f64, BenchError> {
    let r = evaluate(dataset, &|fv: &FeatureVector| {
        let (_axes, ch) = moodwave_classify::classify_with(fv, aw, cw)
            .map_err(|e| BenchError::Invalid(e.to_string()))?;
        Ok(ch)
    })?;
    Ok(r.macro_f1)
}

/// Coordinate-descent search: for each tunable parameter, try small
/// perturbations and keep any that improve macro F1. `rounds` sweeps pass
/// over all parameters.
///
/// # Errors
/// Propagates [`BenchError`] from dataset evaluation.
pub fn calibrate(
    dataset: &Dataset,
    start_aw: &AxisWeights,
    start_cw: &ChannelWeights,
    rounds: usize,
) -> Result<CalibrationResult, BenchError> {
    let mut aw = start_aw.clone();
    let mut cw = start_cw.clone();
    let mut best = macro_f1(dataset, &aw, &cw)?;

    let deltas = [-0.4f32, -0.2, -0.07, 0.07, 0.2, 0.4];
    for _ in 0..rounds {
        let mut improved = false;
        // Axis biases.
        for axis in 0..12 {
            for delta in deltas {
                let mut trial = aw.clone();
                trial.bias[axis] += delta;
                let f = macro_f1(dataset, &trial, &cw)?;
                if f > best + 1e-6 {
                    best = f;
                    aw = trial;
                    improved = true;
                }
            }
        }
        // Axis feature weights.
        for axis in 0..12 {
            let n = aw.weights[axis].len();
            for j in 0..n {
                for delta in deltas {
                    let mut trial = aw.clone();
                    trial.weights[axis][j].1 += delta;
                    let f = macro_f1(dataset, &trial, &cw)?;
                    if f > best + 1e-6 {
                        best = f;
                        aw = trial;
                        improved = true;
                    }
                }
            }
        }
        // Channel axis weights.
        for ch in 0..13 {
            let n = cw.axes[ch].len();
            for j in 0..n {
                for delta in deltas {
                    let mut trial = cw.clone();
                    trial.axes[ch][j].1 += delta;
                    let f = macro_f1(dataset, &aw, &trial)?;
                    if f > best + 1e-6 {
                        best = f;
                        cw = trial;
                        improved = true;
                    }
                }
            }
        }
        if !improved {
            break;
        }
    }

    let classify_tuned = |fv: &FeatureVector| -> Result<_, BenchError> {
        let (_a, ch) = moodwave_classify::classify_with(fv, &aw, &cw)
            .map_err(|e| BenchError::Invalid(e.to_string()))?;
        Ok(ch)
    };
    let baseline = evaluate(dataset, &|fv: &FeatureVector| {
        let (_a, ch) =
            moodwave_classify::classify(fv).map_err(|e| BenchError::Invalid(e.to_string()))?;
        Ok(ch)
    })?;
    let tuned = evaluate(dataset, &classify_tuned)?;
    Ok(CalibrationResult {
        axis_weights: aw,
        channel_weights: cw,
        baseline,
        tuned,
    })
}

/// Serialize tuned weights to JSON (for review before shipping as a new
/// weights version).
///
/// # Errors
/// [`BenchError::Invalid`] on serialization failure.
pub fn weights_to_json(aw: &AxisWeights, cw: &ChannelWeights) -> Result<String, BenchError> {
    serde_json::to_string_pretty(&serde_json::json!({
        "axis_weights": aw,
        "channel_weights": cw,
    }))
    .map_err(|e| BenchError::Invalid(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use moodwave_classify::{default_axis_weights, default_channel_weights};
    use moodwave_core::models::Channel;

    fn tiny_dataset() -> Dataset {
        // One variant per covered channel from the generator.
        let mut ds = crate::generate::generate_synthetic(1);
        ds.name = "calib-test".into();
        ds.provenance = "unit test".into();
        ds
    }

    #[test]
    fn calibration_never_worsens_macro_f1() {
        let ds = tiny_dataset();
        let res = calibrate(&ds, &default_axis_weights(), &default_channel_weights(), 2).unwrap();
        assert!(res.tuned.macro_f1 >= res.baseline.macro_f1 - 1e-9);
        assert!(res.tuned.macro_f1 > 0.0);
    }

    #[test]
    fn weights_roundtrip_json() {
        let aw = default_axis_weights();
        let cw = default_channel_weights();
        let json = weights_to_json(&aw, &cw).unwrap();
        assert!(json.contains("axis_weights"));
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["axis_weights"]["bias"].as_array().unwrap().len(), 12);
    }

    #[test]
    fn labels_use_valid_channel_ids() {
        let ds = crate::generate::generate_synthetic(1);
        for t in &ds.tracks {
            for k in t.labels.keys() {
                assert!(Channel::ALL.iter().any(|c| c.id() == k.as_str()));
            }
        }
    }
}
