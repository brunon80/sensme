//! Tempo estimation and beat tracking (ADR-004).
//!
//! Stage 1: autocorrelation of the onset envelope over lags corresponding to
//! 45–240 BPM, with a log-normal prior centered near 110 BPM to resolve
//! octave ambiguity.
//! Stage 2: dynamic-programming beat tracking (Ellis 2007 style) around the
//! estimated inter-beat interval.

use crate::onset::normalize_max;

/// Tempo/beat analysis result.
#[derive(Debug, Clone)]
pub struct TempoResult {
    /// Estimated tempo in beats per minute.
    pub bpm: f32,
    /// Autocorrelation salience of the chosen tempo, 0.0–1.0.
    pub strength: f32,
    /// Beat-interval consistency: 1 − coefficient of variation of IOIs, 0.0–1.0.
    pub stability: f32,
    /// Mean onset strength at detected beats, 0.0–1.0.
    pub beat_strength: f32,
    /// Detected beat positions in frames.
    pub beats: Vec<usize>,
}

const MIN_BPM: f32 = 45.0;
const MAX_BPM: f32 = 240.0;

pub fn estimate_tempo(odf: &[f32], fps: f32) -> TempoResult {
    if odf.len() < 8 {
        return TempoResult {
            bpm: 0.0,
            strength: 0.0,
            stability: 0.0,
            beat_strength: 0.0,
            beats: Vec::new(),
        };
    }

    // --- Stage 1: autocorrelation with log-normal prior ---
    let min_lag = ((60.0 * fps / MAX_BPM) as usize).max(2);
    let max_lag = (60.0 * fps / MIN_BPM) as usize;
    let max_lag = max_lag.min(odf.len() - 1);

    let prior_center = 60.0 * fps / 110.0; // lag at 110 BPM
                                           // Mean-subtract before correlating: the ODF's DC component otherwise
                                           // inflates long lags and biases toward half-tempo.
    let mean = odf.iter().sum::<f32>() / odf.len() as f32;
    let centered: Vec<f32> = odf.iter().map(|v| v - mean).collect();

    let mut ac = vec![0.0f32; max_lag + 1];
    let mut best_lag = min_lag;
    let mut best_score = f32::MIN;
    let mut zero_lag = 0.0f32;
    for v in &centered {
        zero_lag += v * v;
    }
    zero_lag /= odf.len() as f32;

    for lag in min_lag..=max_lag {
        let mut s = 0.0f32;
        for t in lag..odf.len() {
            s += centered[t] * centered[t - lag];
        }
        // normalize by term count so long lags are not penalized
        ac[lag] = s / (odf.len() - lag) as f32;
        // log-normal prior over lag (octave-symmetric penalty)
        let r = (lag as f32 / prior_center).ln();
        let prior = (-0.5 * (r / 0.55).powi(2)).exp();
        let score = (ac[lag] / (zero_lag + f32::EPSILON)) * prior;
        if score > best_score {
            best_score = score;
            best_lag = lag;
        }
    }

    // Octave-down check: for a periodic onset train the true period is the
    // smallest lag with a near-maximal peak. If a half-lag is nearly as
    // salient, prefer it (fixes half-tempo errors on fast, regular music).
    // The true period is fractional, so test both roundings of best_lag/2.
    loop {
        let half = best_lag / 2;
        if half < min_lag {
            break;
        }
        let cand = [half, half + 1]
            .into_iter()
            .filter(|l| *l >= min_lag && *l <= max_lag)
            .max_by(|a, b| ac[*a].partial_cmp(&ac[*b]).unwrap());
        match cand {
            Some(l) if ac[l] >= 0.8 * ac[best_lag] => best_lag = l,
            _ => break,
        }
    }

    // Sub-frame refinement: parabolic interpolation around the peak lag.
    let refined_lag = {
        let mut lag_f = best_lag as f32;
        if best_lag > 0 && best_lag < max_lag {
            let a = ac[best_lag - 1];
            let b = ac[best_lag];
            let c = ac[best_lag + 1];
            let denom = a - 2.0 * b + c;
            if denom.abs() > f32::EPSILON {
                let delta = 0.5 * (a - c) / denom;
                if delta.abs() <= 1.0 {
                    lag_f += delta;
                }
            }
        }
        lag_f.max(1.0)
    };

    let bpm = 60.0 * fps / refined_lag;
    let strength = (ac[best_lag] / (zero_lag + f32::EPSILON)).clamp(0.0, 1.0);

    // --- Stage 2: DP beat tracking ---
    let delta = best_lag as f32;
    let sigma = (delta / 8.0).max(1.0);
    let tau_min = (delta - delta / 2.0).max(1.0) as usize;
    let tau_max = (delta + delta / 2.0) as usize;

    let mut d = vec![0.0f32; odf.len()];
    let mut back: Vec<Option<usize>> = vec![None; odf.len()];
    for t in 0..odf.len() {
        let mut best = 0.0f32;
        let mut best_tau = None;
        for tau in tau_min..=tau_max {
            if tau > t {
                break;
            }
            let penalty = (tau as f32 - delta).powi(2) / (2.0 * sigma * sigma);
            let v = d[t - tau] - penalty;
            if v > best {
                best = v;
                best_tau = Some(tau);
            }
        }
        d[t] = best + odf[t];
        back[t] = best_tau;
    }

    // backtrack from the best frame in the last `delta` frames
    let search_start = odf.len().saturating_sub(delta as usize + 1);
    let mut t = (search_start..odf.len())
        .max_by(|a, b| d[*a].partial_cmp(&d[*b]).unwrap())
        .unwrap_or_default();
    let mut beats = Vec::new();
    while t > 0 {
        beats.push(t);
        match back[t] {
            Some(tau) => t -= tau,
            None => break,
        }
    }
    beats.reverse();

    // IOI statistics
    let (stability, beat_strength) = if beats.len() >= 3 {
        let iois: Vec<f32> = beats.windows(2).map(|w| (w[1] - w[0]) as f32).collect();
        let mean = iois.iter().sum::<f32>() / iois.len() as f32;
        let var = iois.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / iois.len() as f32;
        let cv = var.sqrt() / (mean + f32::EPSILON);
        let stability = (1.0 - cv).clamp(0.0, 1.0);
        let mut odf_norm = odf.to_vec();
        normalize_max(&mut odf_norm);
        let bs = beats
            .iter()
            .map(|&b| odf_norm[b.min(odf_norm.len() - 1)])
            .sum::<f32>()
            / beats.len() as f32;
        (stability, bs)
    } else {
        (0.0, 0.0)
    };

    TempoResult {
        bpm,
        strength,
        stability,
        beat_strength,
        beats,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::onset::onset_envelope;
    use crate::stft::stft;

    fn click_track(bpm: f32, secs: f32, rate: usize) -> Vec<f32> {
        let n = (secs * rate as f32) as usize;
        let mut x = vec![0.0f32; n];
        let period = (rate as f32 / bpm * 60.0) as usize;
        let mut start = period;
        while start + 220 < n {
            for i in 0..220 {
                x[start + i] =
                    0.9 * (2.0 * std::f32::consts::PI * 3000.0 * i as f32 / rate as f32).sin();
            }
            start += period;
        }
        x
    }

    fn check_bpm(bpm: f32) {
        let rate = 22_050usize;
        let x = click_track(bpm, 8.0, rate);
        let spec = stft(&x, 2048, 512);
        let odf = onset_envelope(&spec);
        let r = estimate_tempo(&odf, crate::stft::frame_rate(rate, 512));
        assert!(
            (r.bpm - bpm).abs() <= 2.0,
            "bpm {bpm}: got {} (stability {})",
            r.bpm,
            r.stability
        );
        assert!(r.stability > 0.8, "bpm {bpm}: stability {}", r.stability);
    }

    macro_rules! bpm_test {
        ($name:ident, $bpm:expr) => {
            #[test]
            fn $name() {
                check_bpm($bpm);
            }
        };
    }

    // Phase 2 done gate: 20 synthetic click-track fixtures, 60–174 BPM.
    bpm_test!(bpm_060, 60.0);
    bpm_test!(bpm_066, 66.0);
    bpm_test!(bpm_072, 72.0);
    bpm_test!(bpm_078, 78.0);
    bpm_test!(bpm_084, 84.0);
    bpm_test!(bpm_090, 90.0);
    bpm_test!(bpm_096, 96.0);
    bpm_test!(bpm_102, 102.0);
    bpm_test!(bpm_108, 108.0);
    bpm_test!(bpm_114, 114.0);
    bpm_test!(bpm_120, 120.0);
    bpm_test!(bpm_126, 126.0);
    bpm_test!(bpm_132, 132.0);
    bpm_test!(bpm_138, 138.0);
    bpm_test!(bpm_144, 144.0);
    bpm_test!(bpm_150, 150.0);
    bpm_test!(bpm_156, 156.0);
    bpm_test!(bpm_162, 162.0);
    bpm_test!(bpm_168, 168.0);
    bpm_test!(bpm_174, 174.0);

    #[test]
    fn bpm_180() {
        check_bpm(180.0);
    }

    #[test]
    fn silence_yields_zero_tempo() {
        let odf = vec![0.0f32; 100];
        let r = estimate_tempo(&odf, 43.0);
        assert!(r.strength < 0.01);
    }
}
