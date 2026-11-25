//! Benchmarking: reference label import, per-channel agreement metrics,
//! and weight calibration (Phase 3).
//!
//! Sony reference labels are directional evidence, not ground truth
//! (AGENTS.md §4). Dataset format: docs/BENCHMARK_FORMAT.md.

pub mod calibrate;
pub mod dataset;
pub mod generate;
pub mod metrics;

pub use calibrate::{calibrate, weights_to_json, CalibrationResult};
pub use dataset::{Dataset, TrackRecord};
pub use metrics::{evaluate, BenchReport};

use sensme_core::models::FeatureVector;

/// Load a dataset and produce the agreement report for the shipped v0
/// classifier.
///
/// # Errors
/// [`BenchError`] on dataset load/validation failure.
pub fn run_bench(dataset_path: &str) -> Result<String, dataset::BenchError> {
    let ds = Dataset::load(dataset_path)?;
    let report = evaluate(&ds, &|fv: &FeatureVector| {
        let (_axes, ch) = sensme_classify::classify(fv)
            .map_err(|e| dataset::BenchError::Invalid(e.to_string()))?;
        Ok(ch)
    })?;
    Ok(report.render())
}

/// Generate the synthetic dataset (27 variants × 8 channels = 216 tracks)
/// and write it as JSON.
///
/// # Errors
/// [`BenchError`] on serialization/IO failure.
pub fn generate_synthetic_dataset(
    per_channel: usize,
    out_path: &str,
) -> Result<usize, dataset::BenchError> {
    let ds = generate::generate_synthetic(per_channel);
    let text = serde_json::to_string_pretty(&ds)
        .map_err(|e| dataset::BenchError::Invalid(e.to_string()))?;
    std::fs::write(out_path, text).map_err(|e| dataset::BenchError::Io(e.to_string()))?;
    Ok(ds.tracks.len())
}

/// Run coordinate-descent calibration from the shipped v0 weights and
/// return baseline vs. tuned reports.
///
/// # Errors
/// [`BenchError`] on dataset load/evaluation failure.
pub fn run_tune(
    dataset_path: &str,
    rounds: usize,
) -> Result<CalibrationResult, dataset::BenchError> {
    let ds = Dataset::load(dataset_path)?;
    calibrate(
        &ds,
        &sensme_classify::default_axis_weights(),
        &sensme_classify::default_channel_weights(),
        rounds,
    )
}
