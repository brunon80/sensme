//! `sensme` CLI — analysis, classification, and benchmarking entry point.
//!
//! `analyze` is live; the remaining subcommands are explicit stubs until
//! their phase (AGENTS.md §3: no silent placeholders).

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
    Scan { path: String },
    /// Run a benchmark dataset and print the agreement report
    Bench { dataset: String },
    /// Tune classifier weights against a benchmark dataset
    Tune { dataset: String },
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
        Command::Classify { .. } => return Err(err("phase 2", "classification")),
        Command::Scan { .. } => return Err(err("phase 2", "library scanning")),
        Command::Bench { dataset } => sensme_bench::run_bench(&dataset).map(|_| ())?,
        Command::Tune { .. } => return Err(err("phase 3", "weight tuning")),
    }
    Ok(())
}
