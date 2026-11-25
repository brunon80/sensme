//! Golden feature-vector gate (Phase 2 done gate): a deterministic
//! synthetic clip is rendered in-code (no binary fixture needed), analyzed,
//! and compared against the committed golden vector within ±1e-4.
//!
//! Regenerate the golden file only on intentional pipeline changes:
//!   UPDATE_GOLDEN=1 cargo test -p sensme-audio --test golden

use std::path::PathBuf;

use sensme_audio::{features, ANALYSIS_RATE};

/// Deterministic synthetic clip at the analysis rate: an A-minor chord
/// (220/261.63/329.63 Hz), a 120 BPM kick (60 Hz burst, exp decay), and a
/// tiny deterministic noise floor (LCG). Pure f32 math — bit-identical
/// across platforms (AGENTS.md §2).
fn synthetic_song() -> Vec<f32> {
    let n = 6 * ANALYSIS_RATE;
    let mut out = Vec::with_capacity(n);
    let mut lcg: u32 = 0x1234_5678;
    for i in 0..n {
        let t = i as f32 / ANALYSIS_RATE as f32;
        let chord = 0.25
            * ((std::f32::consts::TAU * 220.0 * t).sin()
                + (std::f32::consts::TAU * 261.63 * t).sin()
                + (std::f32::consts::TAU * 329.63 * t).sin());
        let phase = t % 0.5; // 120 BPM
        let kick = if phase < 0.2 {
            0.5 * (std::f32::consts::TAU * 60.0 * phase).sin() * (-15.0 * phase).exp()
        } else {
            0.0
        };
        lcg = lcg.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        let noise = ((lcg >> 8) as f32 / 8_388_608.0 - 1.0) * 0.01;
        out.push(chord + kick + noise);
    }
    out
}

fn golden_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/golden_v1.json")
}

#[test]
fn golden_vector_matches() {
    let audio = sensme_audio::Audio {
        sample_rate: ANALYSIS_RATE,
        samples: synthetic_song(),
    };
    let fv = features::extract(&audio);

    if std::env::var("UPDATE_GOLDEN").is_ok() {
        std::fs::write(golden_path(), serde_json::to_string_pretty(&fv).unwrap())
            .expect("write golden");
        eprintln!("golden vector updated");
        return;
    }

    let raw = std::fs::read_to_string(golden_path())
        .expect("golden vector missing; run with UPDATE_GOLDEN=1 once");
    let golden: sensme_core::models::FeatureVector =
        serde_json::from_str(&raw).expect("golden json parses");
    assert_eq!(fv.feature_vector_version, golden.feature_vector_version);
    assert_eq!(fv.values.len(), golden.values.len());
    for (i, (a, b)) in fv.values.iter().zip(&golden.values).enumerate() {
        assert!(
            (a - b).abs() <= 1e-4,
            "feature {i}: golden {b}, got {a} (delta {})",
            (a - b).abs()
        );
    }
}
