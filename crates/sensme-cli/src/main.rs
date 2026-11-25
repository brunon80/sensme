//! `sensme` CLI — analysis, classification, and benchmarking entry point.
//!
//! `analyze`, `scan` and `classify` are live; `bench`/`tune` are explicit
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
    Analyze {
        path: String,
        /// Also store the analysis in the library (track must be scanned first)
        #[arg(long)]
        save: bool,
        /// Library database file
        #[arg(long, default_value = "~/.sensme/library.db")]
        db: String,
    },
    /// Classify stored feature vectors into tone axes and channels
    Classify {
        track_id: Option<u64>,
        /// Library database file
        #[arg(long, default_value = "~/.sensme/library.db")]
        db: String,
    },
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
        Command::Analyze { path, save, db } => {
            let fv = sensme_audio::analyze_file(&path)?;
            if save {
                let db_path = expand_tilde(&db);
                if let Some(parent) = db_path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let mut lib = sensme_core::Library::open(&db_path)?;
                let abs = std::path::absolute(Path::new(&path))?
                    .to_string_lossy()
                    .into_owned();
                let track = lib.track_by_path(&abs)?.ok_or_else(|| {
                    anyhow::anyhow!("track not in library; run `scan` first: {abs}")
                })?;
                lib.store_analysis(track.id, &fv)?;
            }
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
        Command::Classify { track_id, db } => {
            let db_path = expand_tilde(&db);
            let mut lib = sensme_core::Library::open(&db_path)?;
            let tracks = match track_id {
                Some(id) => vec![lib.track_by_id(sensme_core::models::TrackId(id))?],
                None => lib.all_tracks()?,
            };
            let mut classified = 0usize;
            for track in tracks {
                let fv = match lib.analysis_for(track.id) {
                    Ok(fv) => fv,
                    Err(sensme_core::CoreError::AnalysisMissing(_)) => continue,
                    Err(e) => return Err(e.into()),
                };
                let (axes, channels) = sensme_classify::classify(&fv)?;
                lib.store_classification(track.id, &axes, &channels)?;
                classified += 1;
                let top = channels
                    .scores
                    .iter()
                    .enumerate()
                    .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
                    .map(|(i, s)| format!("{} ({s:.2})", sensme_core::models::Channel::ALL[i].id()))
                    .unwrap_or_default();
                println!("{}: top channel {top}", track.path);
            }
            println!("classified {classified} track(s)");
        }
        Command::Bench { dataset } => sensme_bench::run_bench(&dataset).map(|_| ())?,
        Command::Tune { .. } => return Err(err("phase 3", "weight tuning")),
    }
    Ok(())
}
