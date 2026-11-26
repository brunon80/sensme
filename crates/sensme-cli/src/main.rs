//! `sensme` CLI — analysis, classification, and benchmarking entry point.
//!
//! All subcommands are live: `analyze`, `scan`, `classify`, `export`,
//! `bench`, `generate`, `tune`.

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
    /// Export the library (tracks, analyses, classifications) as JSON
    Export {
        /// Library database file
        #[arg(long, default_value = "~/.sensme/library.db")]
        db: String,
        /// Output file (default: stdout)
        #[arg(short, long)]
        out: Option<String>,
    },
    /// Analyze an audio file with the faithful PSP SensMe Channels algorithm
    PspAnalyze {
        path: String,
        /// Print per-slot pair scores
        #[arg(long)]
        pairs: bool,
    },
    /// Run a benchmark dataset and print the agreement report
    Bench { dataset: String },
    /// Generate the deterministic synthetic bench dataset
    Generate {
        /// Output JSON path
        #[arg(short, long, default_value = "bench/datasets/synthetic-v1.json")]
        out: String,
        /// Variants per covered channel (8 channels covered)
        #[arg(long, default_value_t = 27)]
        per_channel: usize,
    },
    /// Tune classifier weights against a benchmark dataset
    Tune {
        dataset: String,
        /// Sweeps over all parameters
        #[arg(long, default_value_t = 3)]
        rounds: usize,
        /// Write tuned weights JSON here
        #[arg(short, long)]
        out: Option<String>,
    },
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
        Command::PspAnalyze { path, pairs } => {
            let audio = sensme_audio::load_mono(&path, 22_050)?;
            let res = sensme_psp::analyze_f32(&audio.samples, audio.sample_rate as u32);
            println!("algorithm: {}", sensme_psp::PSP_ALGORITHM_VERSION);
            println!(
                "chunks={} runs={} mask={:013b}",
                res.chunks, res.runs, res.mask
            );
            let names = sensme_psp::mask_names(res.mask);
            if names.is_empty() {
                println!("channels: (none)");
            } else {
                println!("channels: {}", names.join(", "));
            }
            println!("kind2: {:?}", res.kind2);
            println!("kind3: {:?}", res.kind3);
            if pairs {
                for (i, p) in res.pairs.iter().enumerate() {
                    println!("  slot {i:2}: {p}");
                }
            }
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
        Command::Export { db, out } => {
            let db_path = expand_tilde(&db);
            let lib = sensme_core::Library::open(&db_path)?;
            let entries: Vec<serde_json::Value> = lib
                .all_tracks()?
                .into_iter()
                .map(|t| {
                    serde_json::json!({
                        "track": t,
                        "analysis": lib.analysis_for(t.id).ok(),
                        "classification": lib.classification_for(t.id).ok(),
                    })
                })
                .collect();
            let doc = serde_json::json!({ "library_version": 1, "tracks": entries });
            let text = serde_json::to_string_pretty(&doc)?;
            match out {
                Some(p) => {
                    std::fs::write(p, text)?;
                }
                None => println!("{text}"),
            }
        }
        Command::Bench { dataset } => {
            let report = sensme_bench::run_bench(&dataset)?;
            println!("{report}");
        }
        Command::Generate { out, per_channel } => {
            if let Some(parent) = Path::new(&out).parent() {
                std::fs::create_dir_all(parent)?;
            }
            let n = sensme_bench::generate_synthetic_dataset(per_channel, &out)?;
            println!("wrote {n} tracks to {out}");
        }
        Command::Tune {
            dataset,
            rounds,
            out,
        } => {
            let res = sensme_bench::run_tune(&dataset, rounds)?;
            println!("{}", res.baseline.render());
            println!("== tuned ==");
            println!("{}", res.tuned.render());
            println!(
                "macro F1: {:.3} -> {:.3}",
                res.baseline.macro_f1, res.tuned.macro_f1
            );
            if let Some(path) = out {
                let json = sensme_bench::weights_to_json(&res.axis_weights, &res.channel_weights)?;
                std::fs::write(path, json)?;
            }
        }
    }
    Ok(())
}
