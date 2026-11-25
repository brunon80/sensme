//! Harmonic-percussive source separation via median filtering of the
//! magnitude spectrogram (Fitzgerald 2010 style). Feeds acousticness /
//! instrumentalness proxies.

use crate::stft::Spectrogram;

/// HPSS result.
#[derive(Debug, Clone)]
pub struct HpssStats {
    /// Harmonic energy fraction: sum(H) / (sum(H) + sum(P)), 0.0–1.0.
    pub harmonic_ratio: f32,
}

fn median_of(v: &[f32]) -> f32 {
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    s[s.len() / 2]
}

pub fn hpss_stats(spec: &Spectrogram) -> HpssStats {
    if spec.frames < 3 || spec.bins < 3 {
        return HpssStats {
            harmonic_ratio: 0.0,
        };
    }
    let w_t = 7.min(spec.frames | 1); // odd window across time
    let w_f = 7.min(spec.bins | 1);

    let mut sum_h = 0.0f32;
    let mut sum_p = 0.0f32;
    let mut tmp: Vec<f32> = Vec::with_capacity(w_t.max(w_f));

    for t in 0..spec.frames {
        for b in 0..spec.bins {
            // horizontal median (harmonic): same bin, neighboring frames
            let t0 = t.saturating_sub(w_t / 2);
            let t1 = (t + w_t / 2 + 1).min(spec.frames);
            tmp.clear();
            for tt in t0..t1 {
                tmp.push(spec.get(tt, b));
            }
            let h = median_of(&tmp);

            // vertical median (percussive): same frame, neighboring bins
            let b0 = b.saturating_sub(w_f / 2);
            let b1 = (b + w_f / 2 + 1).min(spec.bins);
            tmp.clear();
            for bb in b0..b1 {
                tmp.push(spec.get(t, bb));
            }
            let p = median_of(&tmp);

            let m = spec.get(t, b);
            // soft mask weighting approximated by hard assignment
            if h >= p {
                sum_h += m;
            } else {
                sum_p += m;
            }
        }
    }

    HpssStats {
        harmonic_ratio: sum_h / (sum_h + sum_p + 1e-12),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steady_tone_is_mostly_harmonic() {
        // constant magnitude in time at one bin → horizontal median keeps it
        let mut spec = Spectrogram {
            frames: 20,
            bins: 16,
            mags: vec![0.0; 20 * 16],
        };
        for t in 0..20 {
            spec.mags[t * 16 + 4] = 1.0;
        }
        let s = hpss_stats(&spec);
        assert!(s.harmonic_ratio > 0.9);
    }

    #[test]
    fn broadband_burst_is_percussive() {
        // one frame with energy everywhere → vertical median keeps it,
        // horizontal median kills it
        let mut spec = Spectrogram {
            frames: 21,
            bins: 32,
            mags: vec![0.0; 21 * 32],
        };
        for b in 0..32 {
            spec.mags[10 * 32 + b] = 1.0;
        }
        let s = hpss_stats(&spec);
        assert!(s.harmonic_ratio < 0.3);
    }
}
