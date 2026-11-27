//! Chroma features and mode (major/minor) detection — the v1 valence proxy
//! (ADR-011; iterate via benchmark in Phase 3).

use crate::stft::Spectrogram;

/// Mode/valence result.
#[derive(Debug, Clone)]
pub struct ModeStats {
    /// Valence proxy: 1.0 = strongly major, 0.0 = strongly minor.
    pub valence: f32,
    /// Fraction of frames agreeing with the global mode, 0.0–1.0.
    pub stability: f32,
}

/// Major and minor triad templates over 12 pitch classes (root at index 0).
/// Triads (not scales): the natural minor scale is a rotation of the major
/// scale, which would make rotation-invariant matching degenerate.
const MAJOR: [f32; 12] = [1., 0., 0., 0., 1., 0., 0., 1., 0., 0., 0., 0.];
const MINOR: [f32; 12] = [1., 0., 0., 1., 0., 0., 0., 1., 0., 0., 0., 0.];

/// Average chroma profile (12 pitch classes, L1-normalized per frame).
pub fn chroma_profile(spec: &Spectrogram, sample_rate: usize) -> [f32; 12] {
    let bin_hz = (sample_rate as f32 / 2.0) / (spec.bins - 1) as f32;
    // pitch range for chroma: C1 (~32.7 Hz) to C7 (~2093 Hz)
    let min_bin = ((32.7 / bin_hz) as usize).max(1);
    let max_bin = ((2093.0 / bin_hz) as usize).min(spec.bins - 1);

    let mut profile = [0.0f32; 12];
    let mut used_frames = 0usize;

    for t in 0..spec.frames {
        let mut frame = [0.0f32; 12];
        let mut total = 0.0f32;
        for b in min_bin..=max_bin {
            let hz = b as f32 * bin_hz;
            if hz <= 0.0 {
                continue;
            }
            // nearest semitone → pitch class
            let midi = (12.0 * (hz / 440.0).log2() + 69.0).round() as i32;
            let pc = (midi.rem_euclid(12)) as usize;
            let v = spec.get(t, b);
            frame[pc] += v;
            total += v;
        }
        if total > 1e-6 {
            for (pc, p) in profile.iter_mut().enumerate() {
                *p += frame[pc] / total;
            }
            used_frames += 1;
        }
    }
    if used_frames > 0 {
        for p in profile.iter_mut() {
            *p /= used_frames as f32;
        }
    }
    profile
}

fn cosine(a: &[f32; 12], t: &[f32; 12]) -> f32 {
    // best rotation (transposition-invariant)
    let mut best = 0.0f32;
    for shift in 0..12 {
        let mut dot = 0.0f32;
        let mut na = 0.0f32;
        let mut nt = 0.0f32;
        for i in 0..12 {
            let av = a[(i + shift) % 12];
            dot += av * t[i];
            na += av * av;
            nt += t[i] * t[i];
        }
        let sim = dot / ((na * nt).sqrt() + 1e-12);
        if sim > best {
            best = sim;
        }
    }
    best
}

pub fn mode_stats(spec: &Spectrogram, sample_rate: usize) -> ModeStats {
    let bin_hz = (sample_rate as f32 / 2.0) / (spec.bins - 1) as f32;
    let min_bin = ((32.7 / bin_hz) as usize).max(1);
    let max_bin = ((2093.0 / bin_hz) as usize).min(spec.bins - 1);

    let global = chroma_profile(spec, sample_rate);
    let g_major = cosine(&global, &MAJOR);
    let g_minor = cosine(&global, &MINOR);
    // Sharpen the comparison: triad overlap ratios are close (2/3 notes
    // shared between best major/minor roots), so raise to a power.
    let (sm, sn) = (g_major.powi(4), g_minor.powi(4));
    let valence = (sm / (sm + sn + 1e-12)).clamp(0.0, 1.0);

    // per-frame agreement with the global mode
    let mut agree = 0usize;
    let mut total = 0usize;
    for t in 0..spec.frames {
        let mut frame = [0.0f32; 12];
        let mut sum = 0.0f32;
        for b in min_bin..=max_bin {
            let hz = b as f32 * bin_hz;
            if hz <= 0.0 {
                continue;
            }
            let midi = (12.0 * (hz / 440.0).log2() + 69.0).round() as i32;
            let pc = midi.rem_euclid(12) as usize;
            frame[pc] += spec.get(t, b);
            sum += spec.get(t, b);
        }
        if sum > 1e-4 {
            for f in frame.iter_mut() {
                *f /= sum;
            }
            let m = cosine(&frame, &MAJOR);
            let n = cosine(&frame, &MINOR);
            let frame_major = m >= n;
            let global_major = valence >= 0.5;
            if frame_major == global_major {
                agree += 1;
            }
            total += 1;
        }
    }

    ModeStats {
        valence,
        stability: if total > 0 {
            agree as f32 / total as f32
        } else {
            0.0
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stft::stft;

    fn chord(freqs: &[f32], secs: usize, rate: usize) -> Vec<f32> {
        (0..secs * rate)
            .map(|i| {
                let s: f32 = freqs
                    .iter()
                    .map(|f| (2.0 * std::f32::consts::PI * f * i as f32 / rate as f32).sin())
                    .sum();
                0.25 * s
            })
            .collect()
    }

    #[test]
    fn major_chord_scores_major() {
        let rate = 22_050usize;
        // A major: A4 440, C#5 554.37, E5 659.25
        let x = chord(&[440.0, 554.37, 659.25], 2, rate);
        let spec = stft(&x, 2048, 512);
        let m = mode_stats(&spec, rate);
        assert!(m.valence > 0.6, "major expected, got {}", m.valence);
    }

    #[test]
    fn minor_chord_scores_minor() {
        let rate = 22_050usize;
        // A minor: A4 440, C5 523.25, E5 659.25
        let x = chord(&[440.0, 523.25, 659.25], 2, rate);
        let spec = stft(&x, 2048, 512);
        let m = mode_stats(&spec, rate);
        assert!(m.valence < 0.4, "minor expected, got {}", m.valence);
    }
}

#[cfg(test)]
mod extra_tests {
    use super::*;
    use crate::stft::stft;

    fn chord(freqs: &[f32], secs: f32, rate: usize) -> Vec<f32> {
        let n = (secs * rate as f32) as usize;
        (0..n)
            .map(|i| {
                let t = i as f32 / rate as f32;
                freqs
                    .iter()
                    .map(|f| (std::f32::consts::TAU * f * t).sin() * 0.3)
                    .sum()
            })
            .collect()
    }

    #[test]
    fn a_minor_chord_lights_a_c_e() {
        let x = chord(&[220.0, 261.63, 329.63], 2.0, 22_050);
        let s = stft(&x, 2048, 512);
        let c = chroma_profile(&s, 22_050);
        // pitch classes: A=9, C=0, E=4
        let mut idx: Vec<usize> = (0..12).collect();
        idx.sort_by(|a, b| c[*b].partial_cmp(&c[*a]).unwrap());
        assert!(
            idx[..3].iter().all(|p| matches!(p, 0 | 4 | 9)),
            "top pitch classes {idx:?}, profile {c:?}"
        );
    }

    #[test]
    fn major_scores_higher_valence_than_minor() {
        let s_maj = stft(&chord(&[220.0, 277.18, 329.63], 2.0, 22_050), 2048, 512);
        let s_min = stft(&chord(&[220.0, 261.63, 329.63], 2.0, 22_050), 2048, 512);
        let maj = mode_stats(&s_maj, 22_050);
        let min = mode_stats(&s_min, 22_050);
        assert!(
            maj.valence > min.valence,
            "major {} <= minor {}",
            maj.valence,
            min.valence
        );
    }
}
