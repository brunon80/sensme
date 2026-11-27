//! Moodwave domain models, library management, and persistence.
//!
//! This crate is the single source of truth for all data shared between the
//! core engine and the platform shells. Models here are mirrored to
//! TypeScript via `ts-rs` (Phase 2) into `contracts/generated/`.

pub mod models;

#[cfg(feature = "db")]
pub mod error;
#[cfg(feature = "db")]
pub mod scan;
#[cfg(feature = "db")]
pub mod storage;

#[cfg(feature = "db")]
pub use error::CoreError;
#[cfg(feature = "db")]
pub use storage::Library;
