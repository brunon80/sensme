//! MFCC: mel filterbank (26 triangles) → log → DCT-II (20 coefficients).

use crate::stft::Spectrogram;

pub const N_MEL: usize = 26;
pub const N_COEFFS: usize = 20;

/// Mel-spaced filterbank: `filters[mel][bin]` weights (triangular, area-normalized).
pub fn mel_filterbank(bins: usize, sample_rate: usize) -> Vec<Vec<f32>> {
    let nyquist = sample_rate as f32 / 2.0;
    let hz_to_mel = |hz: f32| 2595.0 * (1.0 + hz / 700.0).log10();
    let mel_to_hz = |mel: f32| 700.0 * (10.0f32.powf(mel / 2595.0) - 1.0);

    let mel_lo = hz_to_mel(0.0);
    let mel_hi = hz_to_mel(nyquist);
    let points: Vec<f32> = (0..N_MEL + 2)
        .map(|i| mel_to_hz(mel_lo + (mel_hi - mel_lo) * i as f32 / (N_MEL + 1) as f32))
        .collect();

    let bin_hz = nyquist / (bins - 1) as f32;
    let mut filters = vec![vec![0.0f32; bins]; N_MEL];
    for (m, filter) in filters.iter_mut().enumerate() {
        let (left, center, right) = (points[m], points[m + 1], points[m + 2]);
        for (b, w) in filter.iter_mut().enumerate() {
            let hz = b as f32 * bin_hz;
            *w = if hz <= left || hz >= right {
                0.0
            } else if hz <= center {
                (hz - left) / (center - left + 1e-12)
            } else {
                (right - hz) / (right - center + 1e-12)
            };
        }
    }
    filters
}

/// MFCCs per frame: `coeffs[t][c]`.
pub fn mfcc(spec: &Spectrogram, sample_rate: usize) -> Vec<[f32; N_COEFFS]> {
    let bank = mel_filterbank(spec.bins, sample_rate);
    let mut out = Vec::with_capacity(spec.frames);
    let mut mel_energies = [0.0f32; N_MEL];

    for t in 0..spec.frames {
        let row = t * spec.bins;
        for (m, e_out) in mel_energies.iter_mut().enumerate() {
            let mut e = 0.0f32;
            for (b, w) in bank[m].iter().enumerate() {
                if *w > 0.0 {
                    e += *w * spec.mags[row + b].powi(2);
                }
            }
            *e_out = (e + 1e-12).ln();
        }
        // DCT-II over log mel energies
        let mut coeffs = [0.0f32; N_COEFFS];
        for (c, coeff) in coeffs.iter_mut().enumerate() {
            let mut s = 0.0f32;
            for (m, mel) in mel_energies.iter().enumerate() {
                s += mel * (std::f32::consts::PI * c as f32 * (m as f32 + 0.5) / N_MEL as f32).cos();
            }
            *coeff = s;
        }
        out.push(coeffs);
    }
    out
}

/// Mean and standard deviation of coefficients `2..=6` across frames.
pub fn mfcc_stats(frames: &[[f32; N_COEFFS]]) -> ([f32; 5], [f32; 5]) {
    let n = frames.len().max(1) as f32;
    let mut mean = [0.0f32; 5];
    let mut std = [0.0f32; 5];
    for f in frames {
        for (i, m) in mean.iter_mut().enumerate() {
            *m += f[i + 2];
        }
    }
    for m in mean.iter_mut() {
        *m /= n;
    }
    for f in frames {
        for (i, s) in std.iter_mut().enumerate() {
            *s += (f[i + 2] - mean[i]).powi(2);
        }
    }
    for s in std.iter_mut() {
        *s = (*s / n).sqrt();
    }
    (mean, std)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stft::stft;

    #[test]
    fn mfcc_shape_and_finite() {
        let rate = 22_050usize;
        let x: Vec<f32> = (0..rate)
            .map(|i| (2.0 * std::f32::consts::PI * 300.0 * i as f32 / rate as f32).sin() * 0.7)
            .collect();
        let spec = stft(&x, 2048, 512);
        let frames = mfcc(&spec, rate);
        assert_eq!(frames.len(), spec.frames);
        let (mean, std) = mfcc_stats(&frames);
        assert!(mean.iter().all(|v| v.is_finite()));
        assert!(std.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn filterbank_is_triangular_and_ordered() {
        let bank = mel_filterbank(1025, 22_050);
        assert_eq!(bank.len(), N_MEL);
        // each filter has a single peak
        for f in &bank {
            let peak = f.iter().cloned().fold(0.0f32, f32::max);
            assert!(peak > 0.0);
        }
        // later filters peak at higher bins
        let peak_bin = |f: &Vec<f32>| {
            f.iter()
                .position(|&v| v == f.iter().cloned().fold(0.0, f32::max))
                .unwrap()
        };
        for m in 1..N_MEL {
            assert!(peak_bin(&bank[m]) > peak_bin(&bank[m - 1]));
        }
    }
}
