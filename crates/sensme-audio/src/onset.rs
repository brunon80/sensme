//! Onset detection: log-compressed spectral flux (SDF) onset strength
//! envelope.

use crate::stft::Spectrogram;

/// Onset strength envelope, one value per spectrogram frame, normalized so
/// the maximum is 1.0.
pub fn onset_envelope(spec: &Spectrogram) -> Vec<f32> {
    if spec.frames == 0 {
        return Vec::new();
    }
    // log(1 + magnitude) compression, precomputed per bin per frame
    let mut prev: Vec<f32> = vec![0.0; spec.bins];
    let mut odf = vec![0.0f32; spec.frames];
    for (row, o) in spec.mags.chunks(spec.bins).zip(odf.iter_mut()) {
        let mut sum = 0.0f32;
        for (b, prev_v) in prev.iter_mut().enumerate() {
            let cur = (1.0 + row[b]).ln();
            let d = cur - *prev_v;
            if d > 0.0 {
                sum += d;
            }
            *prev_v = cur;
        }
        *o = sum;
    }
    normalize_max(&mut odf);
    odf
}

pub(crate) fn normalize_max(v: &mut [f32]) {
    let max = v.iter().cloned().fold(0.0f32, f32::max);
    if max > f32::EPSILON {
        for x in v.iter_mut() {
            *x /= max;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stft::stft;

    #[test]
    fn clicks_produce_periodic_onset_peaks() {
        let rate = 22_050usize;
        let n = rate * 4; // 4 s
        let hop = 512;
        let mut x = vec![0.0f32; n];
        // click every 0.5 s (120 BPM), last click at 3.5 s (inside buffer)
        for k in 0..7 {
            let start = (k as usize + 1) * rate / 2;
            for i in 0..220 {
                x[start + i] =
                    0.9 * (2.0 * std::f32::consts::PI * 3000.0 * i as f32 / rate as f32).sin();
            }
        }
        let spec = stft(&x, 2048, hop);
        let odf = onset_envelope(&spec);
        assert_eq!(odf.len(), spec.frames);
        let max = odf.iter().cloned().fold(0.0, f32::max);
        assert!((max - 1.0).abs() < 1e-6);
        // peaks near every 0.5 s = every rate/hop/2 frames
        let period = rate / hop / 2; // ~21.5 frames
        let mut hits = 0;
        for k in 1..8 {
            let center = (k as f32 * 0.5 * rate as f32 / hop as f32) as usize;
            let window =
                &odf[center.saturating_sub(period / 3)..(center + period / 3).min(odf.len())];
            if window.iter().cloned().fold(0.0f32, f32::max) > 0.5 {
                hits += 1;
            }
        }
        assert!(hits >= 6, "expected onset peaks at clicks, got {hits}/7");
    }
}
