//! Crate-boundary errors. All fallible operations return `CoreError`.

use thiserror::Error;

/// Errors surfaced by `sensme-core`.
#[derive(Debug, Error)]
pub enum CoreError {
    #[error("track not found: {0}")]
    TrackNotFound(u64),

    #[error("no analysis stored for track {0}")]
    AnalysisMissing(u64),

    #[error("storage error: {0}")]
    Storage(String),

    #[error("not implemented until {phase}: {what}")]
    NotImplemented {
        phase: &'static str,
        what: &'static str,
    },
}
