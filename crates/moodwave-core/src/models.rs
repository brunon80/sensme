//! Core data models. Units and ranges are part of the contract — see doc
//! comments. All analysis-path floats are `f32` for cross-platform
//! determinism (AGENTS.md §2).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Stable identifier of a track within the local library.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TrackId(pub u64);

/// One entry of the library: a local audio file plus its tags.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub id: TrackId,
    /// Absolute path as stored at scan time.
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<u16>,
    /// Duration in milliseconds.
    pub duration_ms: u64,
    /// File size in bytes.
    pub size_bytes: u64,
    /// File modification time, unix epoch seconds.
    pub modified_epoch: i64,
}

/// A versioned, normalized feature vector produced by `moodwave-audio`.
///
/// The layout of `values` is defined by `feature_vector_version`; changing
/// the layout requires bumping it (ADR-012).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../contracts/generated/")]
pub struct FeatureVector {
    /// Version of the analysis pipeline that produced this vector.
    pub algorithm_version: String,
    /// Layout version of `values`.
    pub feature_vector_version: u32,
    /// All values normalized to 0.0–1.0 unless the layout doc says otherwise
    /// (e.g. BPM is stored in Hz-normalized form; see layout spec, Phase 2).
    pub values: Vec<f32>,
}

/// The 12 perceptual tone axes (working set — ADR-011; validated in Phase 3).
pub const TONE_AXES: [&str; 12] = [
    "energetic",
    "excited",
    "groovy",
    "danceable",
    "sensual",
    "sweet",
    "bittersweet",
    "mellow",
    "dreamy",
    "chillout",
    "tough",
    "aggressive",
];

/// Scores on the 12 tone axes, each 0.0–1.0.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../contracts/generated/")]
pub struct ToneAxes {
    /// Ordered to match [`TONE_AXES`].
    pub scores: [f32; 12],
    /// Version of the axis weight set used.
    pub weights_version: String,
}

/// The 13 Moodwave channels (11 PSP channels + split Morning/Day/Night set).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(rename_all = "lowercase")]
#[ts(export, export_to = "../../../contracts/generated/")]
pub enum Channel {
    Energetic,
    Relax,
    Upbeat,
    Mellow,
    Lounge,
    Emotional,
    Dance,
    Extreme,
    Morning,
    Daytime,
    Evening,
    Night,
    Midnight,
}

impl Channel {
    /// All channels, in canonical display order.
    pub const ALL: [Channel; 13] = [
        Channel::Energetic,
        Channel::Relax,
        Channel::Upbeat,
        Channel::Mellow,
        Channel::Lounge,
        Channel::Emotional,
        Channel::Dance,
        Channel::Extreme,
        Channel::Morning,
        Channel::Daytime,
        Channel::Evening,
        Channel::Night,
        Channel::Midnight,
    ];

    /// Stable lowercase identifier used in storage and contracts.
    pub fn id(self) -> &'static str {
        match self {
            Channel::Energetic => "energetic",
            Channel::Relax => "relax",
            Channel::Upbeat => "upbeat",
            Channel::Mellow => "mellow",
            Channel::Lounge => "lounge",
            Channel::Emotional => "emotional",
            Channel::Dance => "dance",
            Channel::Extreme => "extreme",
            Channel::Morning => "morning",
            Channel::Daytime => "daytime",
            Channel::Evening => "evening",
            Channel::Night => "night",
            Channel::Midnight => "midnight",
        }
    }

    /// Whether this channel carries a time-of-day component (ADR-011).
    pub fn is_time_of_day(self) -> bool {
        matches!(
            self,
            Channel::Morning
                | Channel::Daytime
                | Channel::Evening
                | Channel::Night
                | Channel::Midnight
        )
    }
}

/// Per-channel score for one track, each 0.0–1.0.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../contracts/generated/")]
pub struct ChannelScores {
    /// Ordered to match [`Channel::ALL`].
    pub scores: [f32; 13],
    pub weights_version: String,
}

impl ChannelScores {
    /// Score for a specific channel.
    pub fn score_for(&self, channel: Channel) -> f32 {
        self.scores[Channel::ALL.iter().position(|c| *c == channel).unwrap()]
    }
}

/// The full classification result for one track: tone axes plus channel
/// scores. This is the shape exchanged with shells over FFI/wasm (ADR-016);
/// classification remains a pure function of (stored features, weights).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../contracts/generated/")]
pub struct Classification {
    pub axes: ToneAxes,
    pub channels: ChannelScores,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tone_axes_count() {
        assert_eq!(TONE_AXES.len(), 12);
    }

    #[test]
    fn channels_count_and_unique_ids() {
        assert_eq!(Channel::ALL.len(), 13);
        let mut ids: Vec<&str> = Channel::ALL.iter().map(|c| c.id()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 13);
    }

    #[test]
    fn time_of_day_channels() {
        assert!(Channel::Midnight.is_time_of_day());
        assert!(!Channel::Dance.is_time_of_day());
        let tod = Channel::ALL.iter().filter(|c| c.is_time_of_day()).count();
        assert_eq!(tod, 5);
    }
}

#[cfg(test)]
mod extra_tests {
    use super::*;

    #[test]
    fn tone_axes_are_twelve_unique() {
        assert_eq!(TONE_AXES.len(), 12);
        for (i, a) in TONE_AXES.iter().enumerate() {
            assert!(!TONE_AXES[i + 1..].contains(a), "duplicate axis {a}");
        }
    }

    #[test]
    fn channels_are_thirteen_unique() {
        assert_eq!(Channel::ALL.len(), 13);
        for (i, c) in Channel::ALL.iter().enumerate() {
            assert!(
                !Channel::ALL[i + 1..].contains(c),
                "duplicate channel {c:?}"
            );
        }
    }

    #[test]
    fn score_for_matches_channel_position() {
        let scores: [f32; 13] = [
            0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.05, 0.15,
        ];
        let cs = ChannelScores {
            scores,
            weights_version: "t".into(),
        };
        for (i, ch) in Channel::ALL.iter().enumerate() {
            assert_eq!(cs.score_for(*ch), scores[i]);
        }
    }

    #[test]
    fn feature_vector_serde_roundtrip() {
        let fv = FeatureVector {
            algorithm_version: "0.1.0".into(),
            feature_vector_version: 1,
            values: vec![0.25, -0.5, 1.0],
        };
        let json = serde_json::to_string(&fv).unwrap();
        let back: FeatureVector = serde_json::from_str(&json).unwrap();
        assert_eq!(fv, back);
    }
}
