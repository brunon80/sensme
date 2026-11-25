//! Core data models. Units and ranges are part of the contract — see doc
//! comments. All analysis-path floats are `f32` for cross-platform
//! determinism (AGENTS.md §2).

use serde::{Deserialize, Serialize};

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

/// A versioned, normalized feature vector produced by `sensme-audio`.
///
/// The layout of `values` is defined by `feature_vector_version`; changing
/// the layout requires bumping it (ADR-012).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToneAxes {
    /// Ordered to match [`TONE_AXES`].
    pub scores: [f32; 12],
    /// Version of the axis weight set used.
    pub weights_version: String,
}

/// The 13 SensMe channels (11 PSP channels + split Morning/Day/Night set).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChannelScores {
    /// Ordered to match [`Channel::ALL`].
    pub scores: [f32; 13],
    pub weights_version: String,
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
