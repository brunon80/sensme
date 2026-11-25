//! End-to-end property tests for `analyze_file` (Phase 2).

use std::path::{Path, PathBuf};

use sensme_audio::analyze_file;

/// Minimal mono PCM16 WAV writer (self-generated fixtures only).
fn write_wav(path: &Path, rate: usize, samples: &[f32]) {
    let data_len = (samples.len() * 2) as u32;
    let mut bytes: Vec<u8> = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&(rate as u32).to_le_bytes());
    bytes.extend_from_slice(&((rate * 2) as u32).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    std::fs::write(path, bytes).expect("write wav");
}

fn fixture(name: &str) -> PathBuf {
    PathBuf::from("/tmp/opencode/sensme-analysis-tests").join(name)
}

fn click_wav(bpm: f32, secs: f32) -> PathBuf {
    let rate = 44_100usize;
    let n = (secs * rate as f32) as usize;
    let mut x = vec![0.0f32; n];
    let period = (rate as f32 / bpm * 60.0) as usize;
    let mut start = period;
    while start + 300 < n {
        for i in 0..300 {
            x[start + i] =
                0.9 * (2.0 * std::f32::consts::PI * 3000.0 * i as f32 / rate as f32).sin();
        }
        start += period;
    }
    let p = fixture(&format!("clicks-{}-{}.wav", bpm as u32, secs as u32));
    write_wav(&p, rate, &x);
    p
}

fn chord_wav(name: &str, freqs: &[f32], secs: f32) -> PathBuf {
    let rate = 44_100usize;
    let n = (secs * rate as f32) as usize;
    let x: Vec<f32> = (0..n)
        .map(|i| {
            let t = i as f32 / rate as f32;
            freqs
                .iter()
                .map(|f| (2.0 * std::f32::consts::PI * f * t).sin() * 0.25)
                .sum()
        })
        .collect();
    let p = fixture(&format!("chord-{name}.wav"));
    write_wav(&p, rate, &x);
    p
}

fn setup() {
    let dir = PathBuf::from("/tmp/opencode/sensme-analysis-tests");
    std::fs::create_dir_all(&dir).expect("create fixture tmp");
}

#[test]
fn click_track_yields_strong_confident_tempo() {
    setup();
    let fv = analyze_file(click_wav(120.0, 6.0).to_str().unwrap()).unwrap();
    // bpm_norm = bpm/240 → 120 BPM ≈ 0.5
    assert!(
        (fv.values[0] - 0.5).abs() < 0.02,
        "bpm_norm {}",
        fv.values[0]
    );
    assert!(fv.values[1] > 0.3, "tempo_strength {}", fv.values[1]);
    assert!(fv.values[2] > 0.8, "tempo_stability {}", fv.values[2]);
}

#[test]
fn pure_tone_has_no_rhythm_confidence() {
    setup();
    let fv = analyze_file(
        chord_wav("maj-tri", &[220.0, 277.18, 329.63], 3.0)
            .to_str()
            .unwrap(),
    )
    .unwrap();
    assert!(fv.values[1] < 0.05, "tempo_strength {}", fv.values[1]);
}

#[test]
fn major_chord_is_more_valence_positive_than_minor() {
    setup();
    let maj = analyze_file(
        chord_wav("maj", &[220.0, 277.18, 329.63], 3.0)
            .to_str()
            .unwrap(),
    )
    .unwrap();
    let min = analyze_file(
        chord_wav("min", &[220.0, 261.63, 329.63], 3.0)
            .to_str()
            .unwrap(),
    )
    .unwrap();
    assert!(
        maj.values[17] > min.values[17],
        "major valence {} <= minor {}",
        maj.values[17],
        min.values[17]
    );
}

#[test]
fn louder_input_has_higher_rms_feature() {
    setup();
    let rate = 44_100usize;
    let n = 3 * rate;
    let tone = |amp: f32| -> Vec<f32> {
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * 330.0 * i as f32 / rate as f32).sin() * amp)
            .collect()
    };
    let loud = fixture("loud.wav");
    let quiet = fixture("quiet.wav");
    write_wav(&loud, rate, &tone(0.9));
    write_wav(&quiet, rate, &tone(0.05));
    let a = analyze_file(loud.to_str().unwrap()).unwrap();
    let b = analyze_file(quiet.to_str().unwrap()).unwrap();
    assert!(
        a.values[6] > b.values[6] + 0.2,
        "loud {} quiet {}",
        a.values[6],
        b.values[6]
    );
}

#[test]
fn analysis_is_deterministic_across_runs() {
    setup();
    let p = click_wav(96.0, 5.0);
    let ps = p.to_str().unwrap();
    let a = analyze_file(ps).unwrap();
    let b = analyze_file(ps).unwrap();
    assert_eq!(a.values, b.values);
    assert_eq!(a.algorithm_version, b.algorithm_version);
}

#[test]
fn very_short_file_still_produces_valid_vector() {
    setup();
    let rate = 44_100usize;
    let x: Vec<f32> = (0..rate / 5)
        .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / rate as f32).sin())
        .collect();
    let p = fixture("tiny.wav");
    write_wav(&p, rate, &x);
    let fv = analyze_file(p.to_str().unwrap()).unwrap();
    assert_eq!(fv.values.len(), 30);
    assert!(fv
        .values
        .iter()
        .all(|v| v.is_finite() && (0.0..=1.0).contains(v)));
}
