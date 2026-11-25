//! Shared STFT stage: one windowed FFT pass feeds all spectral features.
//!
//! Fixed configuration for determinism: Hann window, `frame`/`hop` in
//! samples, magnitude spectra. Analysis default: 2048/512 at 22 050 Hz
//! (~93 ms frame, ~23 ms hop).

use rustfft::num_complex::Complex;
use rustfft::FftPlanner;

/// Magnitude spectrogram, row-major: `mags[t * bins + b]`.
#[derive(Debug, Clone)]
pub struct Spectrogram {
    pub frames: usize,
    pub bins: usize,
    pub mags: Vec<f32>,
}

impl Spectrogram {
    #[inline]
    pub fn get(&self, t: usize, b: usize) -> f32 {
        self.mags[t * self.bins + b]
    }
}

/// Frame rate of the spectrogram in frames/second.
pub fn frame_rate(sample_rate: usize, hop: usize) -> f32 {
    sample_rate as f32 / hop as f32
}

/// Compute the magnitude STFT of mono `x`.
pub fn stft(x: &[f32], frame: usize, hop: usize) -> Spectrogram {
    assert!(frame > 1 && hop > 0);
    let bins = frame / 2 + 1;
    let window: Vec<f32> = (0..frame)
        .map(|n| 0.5 * (1.0 - (std::f32::consts::TAU * n as f32 / (frame - 1) as f32).cos()))
        .collect();

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(frame);

    let n_frames = x.len().saturating_sub(frame) / hop + 1;
    let mut mags = vec![0.0f32; n_frames * bins];
    let mut buf: Vec<Complex<f32>> = vec![Complex::ZERO; frame];

    for t in 0..n_frames {
        let start = t * hop;
        for (n, w) in window.iter().enumerate() {
            buf[n] = Complex::new(x[start + n] * w, 0.0);
        }
        fft.process(&mut buf);
        let row = &mut mags[t * bins..t * bins + bins];
        for (b, c) in buf[..bins].iter().enumerate() {
            row[b] = c.norm();
        }
    }

    Spectrogram {
        frames: n_frames,
        bins,
        mags,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sine_peak_bin_matches_frequency() {
        let rate = 22_050usize;
        let freq = 440.0f32;
        let n = 22_050;
        let x: Vec<f32> = (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin())
            .collect();
        let spec = stft(&x, 2048, 512);
        assert!(spec.frames > 30);
        // peak bin over the whole file
        let mut best_b = 0usize;
        let mut best_v = 0.0f32;
        for b in 1..spec.bins {
            let s: f32 = (0..spec.frames).map(|t| spec.get(t, b)).sum();
            if s > best_v {
                best_v = s;
                best_b = b;
            }
        }
        let bin_hz = rate as f32 / 2048.0;
        let peak_hz = best_b as f32 * bin_hz;
        assert!((peak_hz - freq).abs() < 2.0 * bin_hz);
    }
}

#[cfg(test)]
mod extra_tests {
    use super::*;

    fn sine(freq: f32, n: usize, rate: f32) -> Vec<f32> {
        (0..n)
            .map(|i| (std::f32::consts::TAU * freq * i as f32 / rate).sin())
            .collect()
    }

    #[test]
    fn frame_count_and_shape_match_input() {
        let x = vec![0.0f32; 4096];
        let s = stft(&x, 2048, 512);
        assert!((5..=8).contains(&s.frames));
        assert_eq!(s.bins, 1025);
        assert_eq!(s.mags.len(), s.frames * s.bins);
    }

    #[test]
    fn sine_peaks_at_expected_bin() {
        let rate = 22_050.0f32;
        let x = sine(440.0, 4096, rate);
        let s = stft(&x, 2048, 512);
        let t = s.frames / 2;
        let mut peak = 0usize;
        for b in 1..s.bins {
            if s.get(t, b) > s.get(t, peak) {
                peak = b;
            }
        }
        let bin_hz = (rate / 2.0) / (s.bins - 1) as f32;
        let hz = peak as f32 * bin_hz;
        assert!((hz - 440.0).abs() < 15.0, "peak at {hz} Hz");
    }

    #[test]
    fn frame_rate_is_rate_over_hop() {
        assert!((frame_rate(22_050, 512) - 43.066).abs() < 0.01);
    }
}
