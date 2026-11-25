//! Decoding to mono f32 at the analysis sample rate (ADR-015).
//!
//! Decode via symphonia (pure Rust, ADR-002), downmix to mono, resample to
//! the target rate via rubato's FFT resampler (fixed ratio, high quality).

use std::fs::File;

use thiserror::Error;

/// Mono audio at a known sample rate, samples in `-1.0..=1.0`.
#[derive(Debug, Clone)]
pub struct Audio {
    pub sample_rate: usize,
    pub samples: Vec<f32>,
}

impl Audio {
    pub fn duration_secs(&self) -> f32 {
        self.samples.len() as f32 / self.sample_rate as f32
    }
}

/// Errors from the decode/resample stage.
#[derive(Debug, Error)]
pub enum AudioError {
    #[error("cannot read file {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("no decodable audio track in {0}")]
    NoAudioTrack(String),

    #[error("decode error in {0}")]
    Decode(String),

    #[error("resample error in {path}: {source}")]
    Resample {
        path: String,
        source: rubato::ResampleError,
    },

    #[error("decoded audio is empty: {0}")]
    Empty(String),
}

/// Decode `path` to mono f32 at `target_rate` Hz.
///
/// Decode errors on individual packets are skipped (corrupt frames should not
/// fail the whole analysis); a file with no decodable audio errors.
pub fn load_mono(path: &str, target_rate: usize) -> Result<Audio, AudioError> {
    let (rate, interleaved, channels) = decode_interleaved_f32(path)?;
    if interleaved.is_empty() {
        return Err(AudioError::Empty(path.to_string()));
    }
    let mono = downmix_mono(interleaved, channels);
    let samples = if rate == target_rate {
        mono
    } else {
        resample(&mono, rate, target_rate, path)?
    };
    Ok(Audio {
        sample_rate: target_rate,
        samples,
    })
}

fn decode_interleaved_f32(path: &str) -> Result<(usize, Vec<f32>, usize), AudioError> {
    use symphonia::core::codecs::audio::AudioDecoderOptions;
    use symphonia::core::codecs::CodecParameters;
    use symphonia::core::errors::Error;
    use symphonia::core::formats::probe::Hint;
    use symphonia::core::formats::{FormatOptions, TrackType};
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;

    let file = File::open(path).map_err(|source| AudioError::Io {
        path: path.to_string(),
        source,
    })?;

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
    {
        hint.with_extension(ext);
    }

    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut reader = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|_| AudioError::NoAudioTrack(path.to_string()))?;

    let track = reader
        .default_track(TrackType::Audio)
        .ok_or_else(|| AudioError::NoAudioTrack(path.to_string()))?;
    let track_id = track.id;
    let audio_params = match track.codec_params.as_ref() {
        Some(CodecParameters::Audio(a)) => a.clone(),
        _ => return Err(AudioError::NoAudioTrack(path.to_string())),
    };

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&audio_params, &AudioDecoderOptions::default())
        .map_err(|_| AudioError::Decode(path.to_string()))?;

    let mut out: Vec<f32> = Vec::new();
    let mut channels = 0usize;
    let rate = audio_params.sample_rate.map(|r| r as usize).unwrap_or(0);

    loop {
        let packet = match reader.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(Error::ResetRequired) => break,
            Err(err) => {
                return Err(AudioError::Decode(format!("{path}: {err}")));
            }
        };
        if packet.track_id != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                if channels == 0 {
                    channels = decoded.num_planes();
                }
                let mut buf: Vec<f32> = Vec::new();
                decoded.copy_to_vec_interleaved(&mut buf);
                out.extend_from_slice(&buf);
            }
            Err(Error::DecodeError(_)) => continue,
            Err(err) => {
                return Err(AudioError::Decode(format!("{path}: {err}")));
            }
        }
    }

    if channels == 0 {
        channels = 1;
    }
    if rate == 0 {
        return Err(AudioError::Decode(format!("{path}: unknown sample rate")));
    }
    Ok((rate, out, channels))
}

fn downmix_mono(interleaved: Vec<f32>, channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved;
    }
    interleaved
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

fn resample(mono: &[f32], from: usize, to: usize, path: &str) -> Result<Vec<f32>, AudioError> {
    use rubato::{audioadapter_buffers::direct::InterleavedSlice, Fft, FixedSync, Resampler};

    let mut resampler = Fft::<f32>::new(from, to, 4096, 1, FixedSync::Both)
        .map_err(|_| AudioError::Decode(format!("{path}: bad rates {from}->{to}")))?;
    let input = InterleavedSlice::new(mono, 1, mono.len())
        .map_err(|_| AudioError::Decode(format!("{path}: buffer setup")))?;
    let owned = resampler
        .process_all(&input, mono.len(), None)
        .map_err(|source| AudioError::Resample {
            path: path.to_string(),
            source,
        })?;
    Ok(owned.take_data())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Write a mono PCM16 WAV for tests (no external fixture needed).
    pub fn write_test_wav(path: &str, rate: usize, samples: &[f32]) {
        let data_len = (samples.len() * 2) as u32;
        let mut bytes: Vec<u8> = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
        bytes.extend_from_slice(&(rate as u32).to_le_bytes());
        bytes.extend_from_slice(&((rate * 2) as u32).to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        std::fs::write(path, bytes).expect("write wav");
    }

    fn sine(freq: f32, secs: f32, rate: usize) -> Vec<f32> {
        (0..(secs * rate as f32) as usize)
            .map(|n| (2.0 * std::f32::consts::PI * freq * n as f32 / rate as f32).sin() * 0.8)
            .collect()
    }

    #[test]
    fn decode_wav_resamples_to_target() {
        let path = "/tmp/opencode/sensme-test-decode.wav";
        write_test_wav(path, 44_100, &sine(440.0, 1.0, 44_100));
        let audio = load_mono(path, 22_050).expect("decode");
        assert_eq!(audio.sample_rate, 22_050);
        // ~1 second of audio at 22.05 kHz
        assert!((audio.samples.len() as f32 - 22_050.0).abs() < 200.0);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn decode_preserves_amplitude_scale() {
        // samples must stay in -1..=1 (f32 normalized), not raw integer scale
        let path = "/tmp/opencode/sensme-test-amp.wav";
        write_test_wav(path, 44_100, &sine(440.0, 1.0, 44_100));
        let audio = load_mono(path, 22_050).expect("decode");
        let peak = audio.samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(
            (peak - 0.8).abs() < 0.05,
            "decoded peak amplitude {peak}, expected ~0.8"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn decode_missing_file_errors() {
        let err = load_mono("/tmp/opencode/definitely-missing.wav", 22_050);
        assert!(matches!(err, Err(AudioError::Io { .. })));
    }
}
