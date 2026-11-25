//! Per-frame spectral descriptors and their aggregate statistics:
//! centroid, rolloff, flatness, band energy ratios, zero-crossing rate.

use crate::stft::Spectrogram;

/// Aggregate spectral statistics over all frames.
#[derive(Debug, Clone)]
pub struct SpectralStats {
    /// Spectral centroid mean, Hz.
    pub centroid_mean_hz: f32,
    /// Spectral centroid standard deviation, Hz.
    pub centroid_std_hz: f32,
    /// 85% energy rolloff mean, Hz.
    pub rolloff_mean_hz: f32,
    /// Geometric/arithmetic spectral flatness mean, 0.0–1.0.
    pub flatness_mean: f32,
    /// Energy fraction below 250 Hz, 0.0–1.0.
    pub band_low_ratio: f32,
    /// Energy fraction 250–2000 Hz, 0.0–1.0.
    pub band_mid_ratio: f32,
    /// Energy fraction above 2000 Hz, 0.0–1.0.
    pub band_high_ratio: f32,
    /// Zero-crossing rate mean (crossings/sample), 0.0–1.0.
    pub zcr_mean: f32,
}

pub fn spectral_stats(
    spec: &Spectrogram,
    sample_rate: usize,
    x: &[f32],
    frame: usize,
    hop: usize,
) -> SpectralStats {
    let nyquist = sample_rate as f32 / 2.0;
    let bin_hz = nyquist / (spec.bins - 1) as f32;

    let mut centroids = Vec::with_capacity(spec.frames);
    let mut rolloffs = Vec::with_capacity(spec.frames);
    let mut flatness = Vec::with_capacity(spec.frames);
    let (mut e_low, mut e_mid, mut e_high, mut e_total) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);

    let low_bin = (250.0 / bin_hz) as usize;
    let high_bin = (2000.0 / bin_hz) as usize;

    for t in 0..spec.frames {
        let row = t * spec.bins;
        let mut total = 0.0f32;
        let mut weighted = 0.0f32;
        let mut log_sum = 0.0f32;
        let mut count = 0usize;

        for b in 0..spec.bins {
            let mag = spec.mags[row + b];
            let power = mag * mag;
            total += power;
            weighted += power * b as f32;
            if power > 1e-12 {
                log_sum += power.ln();
                count += 1;
            }
            if b < low_bin {
                e_low += power;
            } else if b < high_bin {
                e_mid += power;
            } else {
                e_high += power;
            }
        }
        e_total += total;

        if total > 1e-12 {
            centroids.push(weighted / total * bin_hz);
            // flatness = geometric mean / arithmetic mean over active bins
            if count > 0 {
                let geo = (log_sum / count as f32).exp();
                let arith = total / count as f32;
                flatness.push((geo / (arith + 1e-12)).clamp(0.0, 1.0));
            } else {
                flatness.push(0.0);
            }
            // 85% rolloff
            let mut cum = 0.0f32;
            let target = 0.85 * total;
            let mut roll_bin = spec.bins - 1;
            for b in 0..spec.bins {
                cum += spec.mags[row + b].powi(2);
                if cum >= target {
                    roll_bin = b;
                    break;
                }
            }
            rolloffs.push(roll_bin as f32 * bin_hz);
        }
    }

    let mean = |v: &[f32]| -> f32 {
        if v.is_empty() {
            0.0
        } else {
            v.iter().sum::<f32>() / v.len() as f32
        }
    };
    let cmean = mean(&centroids);
    let cstd = if centroids.is_empty() {
        0.0
    } else {
        centroids
            .iter()
            .map(|c| (c - cmean).powi(2))
            .sum::<f32>()
            .sqrt()
            / centroids.len() as f32
    };

    // zero-crossing rate over the same frames
    let mut zcrs = Vec::with_capacity(spec.frames);
    for t in 0..spec.frames {
        let start = t * hop;
        let end = (start + frame).min(x.len());
        let mut zc = 0usize;
        for i in start + 1..end {
            if (x[i] >= 0.0) != (x[i - 1] >= 0.0) {
                zc += 1;
            }
        }
        zcrs.push(zc as f32 / (end - start).max(1) as f32);
    }

    let safe_total = e_total.max(1e-12);
    SpectralStats {
        centroid_mean_hz: cmean,
        centroid_std_hz: cstd,
        rolloff_mean_hz: mean(&rolloffs),
        flatness_mean: mean(&flatness),
        band_low_ratio: e_low / safe_total,
        band_mid_ratio: e_mid / safe_total,
        band_high_ratio: e_high / safe_total,
        zcr_mean: mean(&zcrs),
    }
}

/// Frame-level RMS loudness statistics in dBFS.
#[derive(Debug, Clone)]
pub struct EnergyStats {
    /// Mean frame RMS in dBFS (silence floor −60).
    pub rms_mean_db: f32,
    /// p95 − p5 of frame RMS dB, dB.
    pub dynamic_range_db: f32,
}

pub fn energy_stats(x: &[f32], frame: usize, hop: usize) -> EnergyStats {
    let mut dbs: Vec<f32> = Vec::new();
    let mut start = 0;
    while start + frame <= x.len() {
        let power: f32 = x[start..start + frame].iter().map(|s| s * s).sum::<f32>() / frame as f32;
        dbs.push(10.0 * (power / 1e-12_f32).max(1e-12).log10());
        start += hop;
    }
    if dbs.is_empty() {
        return EnergyStats {
            rms_mean_db: -60.0,
            dynamic_range_db: 0.0,
        };
    }
    dbs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mean_db = x.iter().map(|s| s * s).sum::<f32>().max(1e-12).log10() * 10.0;
    let p5 = dbs[(dbs.len() as f32 * 0.05) as usize];
    let p95 = dbs[((dbs.len() as f32 * 0.95) as usize).min(dbs.len() - 1)];
    EnergyStats {
        rms_mean_db: mean_db.max(-60.0),
        dynamic_range_db: (p95 - p5).max(0.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stft::stft;

    fn tone(freq: f32, n: usize, rate: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin() * 0.8)
            .collect()
    }

    #[test]
    fn centroid_tracks_tone_frequency() {
        let rate = 22_050usize;
        let x = tone(1000.0, rate, rate);
        let spec = stft(&x, 2048, 512);
        let s = spectral_stats(&spec, rate, &x, 2048, 512);
        assert!((s.centroid_mean_hz - 1000.0).abs() < 150.0);
        assert!(s.band_mid_ratio > 0.9);
    }

    #[test]
    fn low_tone_has_low_zcr_and_high_low_band() {
        let rate = 22_050usize;
        let x = tone(100.0, rate, rate);
        let spec = stft(&x, 2048, 512);
        let s = spectral_stats(&spec, rate, &x, 2048, 512);
        assert!(s.band_low_ratio > 0.9);
        assert!(s.zcr_mean < 0.05);
    }
}
