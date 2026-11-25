//! SensMe domain models, library management, and persistence.
//!
//! This crate is the single source of truth for all data shared between the
//! core engine and the platform shells. Models here are mirrored to
//! TypeScript via `ts-rs` (Phase 2) into `contracts/generated/`.

pub mod error;
pub mod models;

pub use error::CoreError;
