//! Benchmarking: reference label import, per-channel agreement metrics, and
//! weight calibration (Phase 3).
//!
//! Sony reference labels are directional evidence, not ground truth
//! (AGENTS.md §4). Dataset format: docs/BENCHMARK_FORMAT.md (Phase 3).

use sensme_core::error::CoreError;

/// Import a reference dataset and report agreement for a weights version.
///
/// # Errors
/// [`CoreError::NotImplemented`] until Phase 3.
pub fn run_bench(_dataset_path: &str) -> Result<String, CoreError> {
    // TODO(phase-3): import + per-channel precision/recall/F1 report.
    Err(CoreError::NotImplemented {
        phase: "phase 3",
        what: "benchmark run",
    })
}
