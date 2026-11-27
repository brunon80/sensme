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
    let mean_power = x.iter().map(|s| s * s).sum::<f32>() / x.len().max(1) as f32;
    let mean_db = mean_power.max(1e-12).log10() * 10.0;
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

#[cfg(test)]
mod extra_tests {
    use super::*;
    use crate::stft::stft;

    fn tone(freq: f32, secs: usize) -> Vec<f32> {
        let n = secs * 22_050;
        (0..n)
            .map(|i| (std::f32::consts::TAU * freq * i as f32 / 22_050.0).sin())
            .collect()
    }

    #[test]
    fn band_ratios_sum_to_one() {
        let x = tone(440.0, 2);
        let s = stft(&x, 2048, 512);
        let st = spectral_stats(&s, 22_050, &x, 2048, 512);
        let sum = st.band_low_ratio + st.band_mid_ratio + st.band_high_ratio;
        assert!((sum - 1.0).abs() < 0.02, "band sum {sum}");
        assert!(st.band_mid_ratio > 0.9, "mid {}", st.band_mid_ratio);
    }

    #[test]
    fn tone_is_less_flat_and_darker_than_noise() {
        let t = tone(440.0, 2);
        let mut lcg = 7u32;
        let n: Vec<f32> = (0..2 * 22_050)
            .map(|_| {
                lcg = lcg.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (lcg >> 8) as f32 / 8_388_608.0 - 1.0
            })
            .collect();
        let a = spectral_stats(&stft(&t, 2048, 512), 22_050, &t, 2048, 512);
        let b = spectral_stats(&stft(&n, 2048, 512), 22_050, &n, 2048, 512);
        assert!(
            a.flatness_mean < b.flatness_mean,
            "tone flatness {} >= noise {}",
            a.flatness_mean,
            b.flatness_mean
        );
        assert!(
            a.centroid_mean_hz < b.centroid_mean_hz,
            "tone centroid {} >= noise {}",
            a.centroid_mean_hz,
            b.centroid_mean_hz
        );
    }
}

#[cfg(test)]
mod energy_tests {
    use super::*;

    fn tone(freq: f32, amp: f32, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (std::f32::consts::TAU * freq * i as f32 / 22_050.0).sin() * amp)
            .collect()
    }

    #[test]
    fn rms_db_is_independent_of_signal_length() {
        let loud = energy_stats(&tone(440.0, 0.9, 22_050 * 5), 2048, 512);
        let short = energy_stats(&tone(440.0, 0.9, 22_050), 2048, 512);
        assert!(
            (loud.rms_mean_db - short.rms_mean_db).abs() < 0.5,
            "loud {} vs short {}",
            loud.rms_mean_db,
            short.rms_mean_db
        );
    }

    #[test]
    fn quiet_tone_is_far_below_full_scale() {
        // amplitude 0.05 sine → RMS ≈ -29 dBFS, not 0
        let e = energy_stats(&tone(330.0, 0.05, 22_050 * 3), 2048, 512);
        assert!(
            (e.rms_mean_db - (-27.0)).abs() < 3.0,
            "rms_mean_db {} expected ~-27",
            e.rms_mean_db
        );
    }

    #[test]
    fn silence_hits_floor() {
        let e = energy_stats(&vec![0.0f32; 22_050], 2048, 512);
        assert!(e.rms_mean_db <= -59.0, "floor {}", e.rms_mean_db);
    }
}
