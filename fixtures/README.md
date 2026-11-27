# Test fixtures

- `formats/` — a 3 s, 440 Hz, 44.1 kHz sine encoded in each supported
  container/codec (MP3, FLAC, OGG, M4A, WAV). Generated locally with
  `ffmpeg -f lavfi -i sine=frequency=440:duration=3:sample_rate=44100`
  (self-generated content; no third-party or copyrighted material).
- `golden_v1.json` — golden feature vector for the deterministic synthetic
  clip rendered by `tests/golden.rs`. Regenerate with
  `UPDATE_GOLDEN=1 cargo test -p moodwave-audio --test golden` (only when the
  pipeline version is intentionally bumped; CI compares within ±1e-4).
