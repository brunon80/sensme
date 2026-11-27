//! Deterministic synthetic dataset generator.
//!
//! Renders short clips with by-construction channel intent (tempo, mode,
//! loudness, timbre, rhythm strength), analyzes them with the current
//! pipeline, and stores the resulting feature vectors. Labels are *intent*
//! labels, not human listening labels — the dataset provenance says so.

use std::collections::BTreeMap;

use moodwave_audio::{analyze_audio, Audio, ANALYSIS_RATE};

use crate::dataset::{Dataset, TrackRecord};

/// Channels the generator covers (time-of-day channels cannot be labeled
/// by construction and stay unlabeled).
const COVERED: [moodwave_core::models::Channel; 8] = [
    moodwave_core::models::Channel::Dance,
    moodwave_core::models::Channel::Energetic,
    moodwave_core::models::Channel::Extreme,
    moodwave_core::models::Channel::Upbeat,
    moodwave_core::models::Channel::Lounge,
    moodwave_core::models::Channel::Emotional,
    moodwave_core::models::Channel::Mellow,
    moodwave_core::models::Channel::Relax,
];

/// Synthesis recipe for one intended channel.
struct Recipe {
    bpm: (f32, f32),
    amplitude: f32,
    minor: bool,
    /// Harmonic richness: 0 = pure tone, 1 = saw-like, 2 = + noise mix.
    timbre: u8,
    /// Click envelope depth 0..1 (rhythm salience).
    click: f32,
    /// Channels this clip is explicitly *not*.
    negatives: [moodwave_core::models::Channel; 2],
}

fn recipe(c: moodwave_core::models::Channel) -> Recipe {
    use moodwave_core::models::Channel::*;
    match c {
        Dance => Recipe {
            bpm: (124.0, 132.0),
            amplitude: 0.50,
            minor: false,
            timbre: 1,
            click: 0.85,
            negatives: [Relax, Mellow],
        },
        Energetic => Recipe {
            bpm: (150.0, 170.0),
            amplitude: 0.70,
            minor: false,
            timbre: 1,
            click: 0.80,
            negatives: [Relax, Mellow],
        },
        Extreme => Recipe {
            bpm: (160.0, 185.0),
            amplitude: 0.90,
            minor: true,
            timbre: 2,
            click: 0.90,
            negatives: [Relax, Mellow],
        },
        Upbeat => Recipe {
            bpm: (100.0, 120.0),
            amplitude: 0.45,
            minor: false,
            timbre: 1,
            click: 0.55,
            negatives: [Relax, Extreme],
        },
        Lounge => Recipe {
            bpm: (88.0, 100.0),
            amplitude: 0.35,
            minor: true,
            timbre: 0,
            click: 0.45,
            negatives: [Extreme, Energetic],
        },
        Emotional => Recipe {
            bpm: (76.0, 96.0),
            amplitude: 0.40,
            minor: true,
            timbre: 0,
            click: 0.30,
            negatives: [Extreme, Dance],
        },
        Mellow => Recipe {
            bpm: (62.0, 78.0),
            amplitude: 0.25,
            minor: false,
            timbre: 0,
            click: 0.20,
            negatives: [Extreme, Dance],
        },
        Relax => Recipe {
            bpm: (56.0, 70.0),
            amplitude: 0.18,
            minor: false,
            timbre: 0,
            click: 0.05,
            negatives: [Dance, Extreme],
        },
        _ => unreachable!("COVERED only lists the eight non-time channels"),
    }
}

/// Small deterministic PRNG (xorshift64*) so datasets regenerate byte-identically.
struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * ((self.next_u64() >> 40) as f32 / (1u64 << 24) as f32)
    }
}

/// Render one clip per the recipe; 3 s at the analysis rate.
fn synth(channel: moodwave_core::models::Channel, variant: usize) -> Audio {
    let r = recipe(channel);
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15 ^ ((channel as u64) << 8) ^ variant as u64);
    let bpm = rng.range(r.bpm.0, r.bpm.1);
    let root = rng.range(196.0, 262.0);
    let third = if r.minor { 6.0 / 5.0 } else { 5.0 / 4.0 };
    let notes = [root, root * third, root * 3.0 / 2.0];

    let rate = ANALYSIS_RATE as f32;
    let n = 3usize * ANALYSIS_RATE;
    let beat_period = 60.0 / bpm;
    let mut samples = vec![0.0f32; n];
    let mut noise_state: u32 = 0x1234_5678;

    for (i, sample) in samples.iter_mut().enumerate() {
        let t = i as f32 / rate;
        // Chord drone with per-variant timbre.
        let mut tone = 0.0f32;
        for (hi, f) in notes.iter().enumerate() {
            let partials: usize = match r.timbre {
                0 => 1,
                _ => 6,
            };
            for h in 1..=partials {
                let amp = if h == 1 { 1.0 } else { 0.5 / h as f32 };
                tone += amp * (2.0 * std::f32::consts::PI * f * (hi as f32 * 0.5 + 1.0) * t).sin();
            }
        }
        tone /= notes.len() as f32 * 2.0;

        // Click envelope: exponential decay at each beat.
        let phase = (t % beat_period) / beat_period;
        let env = 1.0 - r.click * (1.0 - (-8.0 * phase).exp());

        // Optional noise layer (dissonance for "extreme").
        noise_state = noise_state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        let noise = ((noise_state >> 16) as f32 / 32768.0) - 1.0;
        let noise_mix = if r.timbre == 2 { 0.25 } else { 0.0 };

        let s = r.amplitude * (tone * env + noise_mix * noise);
        *sample = s.clamp(-1.0, 1.0);
    }
    Audio {
        sample_rate: ANALYSIS_RATE,
        samples,
    }
}

/// Build the synthetic dataset with `per_channel` variants per covered channel.
pub fn generate_synthetic(per_channel: usize) -> Dataset {
    let mut tracks = Vec::new();
    for channel in COVERED {
        for v in 0..per_channel {
            let audio = synth(channel, v);
            let fv = analyze_audio(&audio);
            let mut labels = BTreeMap::new();
            labels.insert(channel.id().to_string(), true);
            for n in recipe(channel).negatives {
                labels.insert(n.id().to_string(), false);
            }
            tracks.push(TrackRecord {
                id: format!("{}-{v:03}", channel.id()),
                features: Some(fv),
                audio: None,
                labels,
            });
        }
    }
    Dataset {
        format_version: 1,
        name: "synthetic-v1".into(),
        created: "2026-11-25".into(),
        provenance: "Self-generated synthetic clips rendered deterministically \
             (xorshift-seeded) and analyzed with the current pipeline; labels are \
             by-construction intent labels, not human listening labels. Directional \
             evidence only (AGENTS.md §4)."
            .into(),
        label_scale: "binary".into(),
        tracks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generation_is_deterministic() {
        let a = synth(moodwave_core::models::Channel::Dance, 3);
        let b = synth(moodwave_core::models::Channel::Dance, 3);
        assert_eq!(a.samples, b.samples);
    }

    #[test]
    fn recipes_produce_distinct_tempi() {
        let relax = synth(moodwave_core::models::Channel::Relax, 0);
        let dance = synth(moodwave_core::models::Channel::Dance, 0);
        let fr = analyze_audio(&relax);
        let fd = analyze_audio(&dance);
        // Feature index 0 is normalized BPM.
        assert!(
            fd.values[0] > fr.values[0] + 0.1,
            "dance bpm {} should exceed relax bpm {}",
            fd.values[0],
            fr.values[0]
        );
    }

    #[test]
    fn dataset_validates_and_has_expected_size() {
        let ds = generate_synthetic(2);
        ds.validate().unwrap();
        assert_eq!(ds.tracks.len(), 16);
        for t in &ds.tracks {
            assert_eq!(t.labels.values().filter(|v| **v).count(), 1);
        }
    }
}
