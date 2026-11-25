//! `sensme` CLI — analysis, classification, and benchmarking entry point.
//!
//! `analyze` and `scan` are live; the remaining subcommands are explicit
//! stubs until their phase (AGENTS.md §3: no silent placeholders).

use std::path::{Path, PathBuf};

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "sensme", version, about = "SensMe music intelligence core")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Analyze an audio file and print its versioned feature vector
    Analyze { path: String },
    /// Classify stored feature vectors into tone axes and channels
    Classify { track_id: Option<u64> },
    /// Scan a directory into the local library
    Scan {
        path: String,
        /// Library database file
        #[arg(long, default_value = "~/.sensme/library.db")]
        db: String,
    },
    /// Run a benchmark dataset and print the agreement report
    Bench { dataset: String },
    /// Tune classifier weights against a benchmark dataset
    Tune { dataset: String },
}

/// Expand a leading `~` to the user's home directory.
fn expand_tilde(path: &str) -> std::path::PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return Path::new(&home).join(rest);
        }
    }
    PathBuf::from(path)
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let err = |phase: &'static str, what: &'static str| {
        anyhow::anyhow!("not implemented until {phase}: {what}")
    };
    match cli.command {
        Command::Analyze { path } => {
            let fv = sensme_audio::analyze_file(&path)?;
            println!("{}", serde_json::to_string_pretty(&fv)?);
        }
        Command::Scan { path, db } => {
            let db_path = expand_tilde(&db);
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut lib = sensme_core::Library::open(&db_path)?;
            let stats = sensme_core::scan::scan_directory(&mut lib, Path::new(&path))?;
            println!(
                "scan complete: {} added, {} updated, {} unchanged, {} skipped",
                stats.added, stats.updated, stats.unchanged, stats.skipped
            );
        }
        Command::Classify { .. } => return Err(err("phase 2", "classification")),
        Command::Bench { dataset } => sensme_bench::run_bench(&dataset).map(|_| ())?,
        Command::Tune { .. } => return Err(err("phase 3", "weight tuning")),
    }
    Ok(())
}
