//! Feature vector assembly. The layout below is the contract:
//! `FEATURE_VECTOR_VERSION` changes iff this layout changes (ADR-012).
//!
//! All values are normalized to 0.0–1.0 unless the name says otherwise.

use crate::audio::Audio;
use crate::chroma;
use crate::hpss;
use crate::mfcc;
use crate::onset;
use crate::spectral;
use crate::stft;
use crate::tempo;
use sensme_core::models::FeatureVector;

use crate::{ALGORITHM_VERSION, FEATURE_VECTOR_VERSION};

/// Analysis sample rate (ADR-015).
pub const ANALYSIS_RATE: usize = 22_050;
/// STFT frame size in samples (~93 ms at 22.05 kHz).
pub const FRAME: usize = 2048;
/// STFT hop in samples (~23 ms).
pub const HOP: usize = 512;

/// Feature vector layout v1 — index → name.
pub const FEATURE_NAMES_V1: [&str; 30] = [
    "bpm_norm",            // bpm / 240
    "tempo_strength",      // autocorrelation salience
    "tempo_stability",     // 1 - IOI coefficient of variation
    "beat_strength",       // mean onset strength at beats
    "onset_rate_norm",     // onsets/sec / 8, capped at 1
    "rhythm_regularity",   // onset envelope autocorrelation peak (best lag)
    "rms_db_norm",         // (dBFS + 60) / 60
    "dynamic_range_norm",  // dB range / 60, capped at 1
    "onset_strength_mean", // mean ODF
    "centroid_mean_norm",  // Hz / 11025
    "centroid_std_norm",   // Hz / 11025
    "rolloff_mean_norm",   // Hz / 11025
    "flatness_mean",
    "band_low_ratio",  // < 250 Hz
    "band_mid_ratio",  // 250–2000 Hz
    "band_high_ratio", // > 2000 Hz
    "zcr_mean_norm",   // crossings/sample / 0.5
    "mode_valence",    // 1 = major, 0 = minor
    "mode_stability",
    "harmonic_ratio", // HPSS harmonic fraction
    "mfcc_mean_2",    // (coeff + 20) / 40
    "mfcc_mean_3",
    "mfcc_mean_4",
    "mfcc_mean_5",
    "mfcc_mean_6",
    "mfcc_std_2", // std / 20, capped at 1
    "mfcc_std_3",
    "mfcc_std_4",
    "mfcc_std_5",
    "mfcc_std_6",
];

fn clamp01(v: f32) -> f32 {
    v.clamp(0.0, 1.0)
}

/// Extract the full v1 feature vector from mono 22.05 kHz audio.
pub fn extract(audio: &Audio) -> FeatureVector {
    assert_eq!(
        audio.sample_rate, ANALYSIS_RATE,
        "audio must be resampled to {ANALYSIS_RATE} Hz before extraction"
    );

    let spec = stft::stft(&audio.samples, FRAME, HOP);
    let fps = stft::frame_rate(audio.sample_rate, HOP);

    let odf = onset::onset_envelope(&spec);
    let tempo = tempo::estimate_tempo(&odf, fps);

    // onset rate: count peaks above 0.5 * local mean with 50 ms refractory
    let onset_rate = count_onsets(&odf, fps);

    // rhythm regularity: autocorrelation peak at the beat lag
    let regularity = if tempo.beats.len() >= 3 {
        tempo.stability
    } else {
        0.0
    };

    let energy = spectral::energy_stats(&audio.samples, FRAME, HOP);
    let spectral_s = spectral::spectral_stats(&spec, audio.sample_rate, &audio.samples, FRAME, HOP);
    let mode = chroma::mode_stats(&spec, audio.sample_rate);
    let hpss = hpss::hpss_stats(&spec);
    let mfcc_frames = mfcc::mfcc(&spec, audio.sample_rate);
    let (m_mean, m_std) = mfcc::mfcc_stats(&mfcc_frames);

    let values = vec![
        clamp01(tempo.bpm / 240.0),
        clamp01(tempo.strength),
        clamp01(tempo.stability),
        clamp01(tempo.beat_strength),
        clamp01(onset_rate / 8.0),
        clamp01(regularity),
        clamp01((energy.rms_mean_db + 60.0) / 60.0),
        clamp01(energy.dynamic_range_db / 60.0),
        clamp01(odf.iter().sum::<f32>() / odf.len().max(1) as f32),
        clamp01(spectral_s.centroid_mean_hz / 11_025.0),
        clamp01(spectral_s.centroid_std_hz / 11_025.0),
        clamp01(spectral_s.rolloff_mean_hz / 11_025.0),
        clamp01(spectral_s.flatness_mean),
        clamp01(spectral_s.band_low_ratio),
        clamp01(spectral_s.band_mid_ratio),
        clamp01(spectral_s.band_high_ratio),
        clamp01(spectral_s.zcr_mean / 0.5),
        clamp01(mode.valence),
        clamp01(mode.stability),
        clamp01(hpss.harmonic_ratio),
        clamp01((m_mean[0] + 20.0) / 40.0),
        clamp01((m_mean[1] + 20.0) / 40.0),
        clamp01((m_mean[2] + 20.0) / 40.0),
        clamp01((m_mean[3] + 20.0) / 40.0),
        clamp01((m_mean[4] + 20.0) / 40.0),
        clamp01(m_std[0] / 20.0),
        clamp01(m_std[1] / 20.0),
        clamp01(m_std[2] / 20.0),
        clamp01(m_std[3] / 20.0),
        clamp01(m_std[4] / 20.0),
    ];
    debug_assert_eq!(values.len(), FEATURE_NAMES_V1.len());

    FeatureVector {
        algorithm_version: ALGORITHM_VERSION.to_string(),
        feature_vector_version: FEATURE_VECTOR_VERSION,
        values,
    }
}

/// Peak-pick onsets: local maxima above 0.4 with 50 ms refractory period.
fn count_onsets(odf: &[f32], fps: f32) -> f32 {
    if odf.len() < 3 {
        return 0.0;
    }
    let refractory = (0.05 * fps) as usize;
    let mut count = 0usize;
    let mut last = usize::MAX / 2;
    for t in 1..odf.len() - 1 {
        if odf[t] > 0.4 && odf[t] >= odf[t - 1] && odf[t] > odf[t + 1] && t - last > refractory {
            count += 1;
            last = t;
        }
    }
    count as f32 / (odf.len() as f32 / fps).max(0.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(freq: f32, secs: usize, rate: usize) -> Audio {
        Audio {
            sample_rate: rate,
            samples: (0..secs * rate)
                .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin() * 0.7)
                .collect(),
        }
    }

    #[test]
    fn vector_has_v1_layout_and_ranges() {
        let fv = extract(&tone(440.0, 3, ANALYSIS_RATE));
        assert_eq!(fv.feature_vector_version, 1);
        assert_eq!(fv.values.len(), 30);
        assert!(fv.values.iter().all(|v| *v >= 0.0 && *v <= 1.0));
        assert!(fv.values.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn extraction_is_deterministic() {
        let a = tone(330.0, 2, ANALYSIS_RATE);
        let b = extract(&a);
        let c = extract(&a);
        assert_eq!(b.values, c.values);
    }
}
