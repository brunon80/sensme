//! `sensme analyze` must produce a versioned feature vector for every
//! supported container/codec (Phase 2 done gate).

use sensme_audio::{analyze_bytes, analyze_file, FEATURE_VECTOR_VERSION};

const FORMATS: [&str; 5] = ["mp3", "flac", "ogg", "m4a", "wav"];

#[test]
fn analyzes_every_supported_format() {
    for fmt in FORMATS {
        let path = format!(
            "{}/../../fixtures/formats/tone.{}",
            env!("CARGO_MANIFEST_DIR"),
            fmt
        );
        let fv = analyze_file(&path).unwrap_or_else(|e| panic!("analyze {fmt}: {e}"));
        assert_eq!(fv.feature_vector_version, FEATURE_VECTOR_VERSION, "{fmt}");
        assert_eq!(fv.values.len(), 30, "{fmt}");
        assert!(
            fv.values
                .iter()
                .all(|v| v.is_finite() && (0.0..=1.0).contains(v)),
            "{fmt}: values out of range"
        );
        // 440 Hz tone: energy concentrated in the mid band
        assert!(
            fv.values[14] > 0.9,
            "{fmt}: band_mid ratio {}",
            fv.values[14]
        );
    }
}

#[test]
fn bytes_entry_point_matches_file() {
    // The wasm/web path (ADR-016) decodes in-memory bytes: it must produce
    // bit-identical vectors to the file path for every format.
    for fmt in FORMATS {
        let path = format!(
            "{}/../../fixtures/formats/tone.{}",
            env!("CARGO_MANIFEST_DIR"),
            fmt
        );
        let bytes = std::fs::read(&path).unwrap();
        let from_file = analyze_file(&path).unwrap();
        let from_bytes =
            analyze_bytes(&format!("tone.{fmt}"), &bytes).unwrap_or_else(|e| panic!("{fmt}: {e}"));
        assert_eq!(from_file.values, from_bytes.values, "{fmt}: bytes != file");
    }
}

#[test]
fn vectors_match_across_containers() {
    // The same source tone in different codecs must land within a small
    // tolerance of each other (codec artifacts are small by construction).
    let base = analyze_file(&format!(
        "{}/../../fixtures/formats/tone.wav",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    for fmt in ["mp3", "flac", "ogg", "m4a"] {
        let other = analyze_file(&format!(
            "{}/../../fixtures/formats/tone.{}",
            env!("CARGO_MANIFEST_DIR"),
            fmt
        ))
        .unwrap();
        // Compare the stable spectral features; rhythm (0–8) and mode
        // (17–18) features are spurious/codec-sensitive on a pure tone.
        for i in (9..=16).chain(std::iter::once(19)) {
            let (a, b) = (base.values[i], other.values[i]);
            assert!((a - b).abs() < 0.15, "{fmt}: feature {i} delta {a} vs {b}");
        }
    }
}
