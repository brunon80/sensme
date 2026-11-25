# SensMe Architecture

Status: approved (Phase 1). Changes to anything marked **Decision** require a new ADR in `docs/TECHNICAL_DECISIONS.md`.

## 1. System overview

```
┌─────────────────────────────────────────────────────────────┐
│  Shells: Tauri (Win/Linux/macOS) · React Native (iOS/And)   │
│          React web (secondary)                              │
│  All UI logic thin; all domain logic in core                │
├─────────────────────────────────────────────────────────────┤
│  sensme-ffi (UniFFI)  │  Tauri commands  │  WASM bindings   │
├─────────────────────────────────────────────────────────────┤
│                    sensme-core (Rust)                       │
│  ├─ library:     scanning, tagging, SQLite persistence      │
│  ├─ audioio:     decode (symphonia), resample, normalize    │
│  ├─ analysis:    feature extraction pipeline (versioned)    │
│  ├─ classifier:  tone axes + channel scoring (pluggable)    │
│  ├─ bench:       reference import, agreement metrics        │
│  └─ contract:    serde + ts-rs shared data models           │
├─────────────────────────────────────────────────────────────┤
│  sensme-cli: analyze / classify / bench / tune commands     │
└─────────────────────────────────────────────────────────────┘
```

**Decision — one Rust core, thin shells.** Desktop via Tauri 2, mobile via
React Native + UniFFI, web via wasm-bindgen. No business logic is duplicated
in any shell. Tauri Mobile was evaluated and rejected (RN has superior media
and store tooling; see ADR-008).

## 2. Crate map

| Crate | Responsibility | Key deps |
|---|---|---|
| `sensme-core` | Domain models, library scanning, SQLite persistence, config | rusqlite (bundled), lofty, serde, ts-rs |
| `sensme-audio` | Decode, resample, STFT, all feature extractors | symphonia, rustfft, fundsp, rubato |
| `sensme-classify` | Tone-axis scoring, channel mapping, weight configs | sensme-core (models) |
| `sensme-bench` | Reference dataset import, agreement metrics, calibration | sensme-core, sensme-classify |
| `sensme-ffi` | UniFFI interface for Kotlin/Swift | uniffi, sensme-core |
| `sensme-wasm` | wasm-bindgen surface | wasm-bindgen, sensme-core |
| `sensme-cli` | CLI: `analyze`, `classify`, `bench`, `tune` | clap, all of the above |

Dependency direction is strictly one-way: `audio → core`, `classify → core`,
`bench → {core, classify}`, shells → `{core, ffi, wasm}`. No cycles.

## 3. Analysis pipeline (the heart)

**Decision — two-stage model: features → 12 tone axes → channels.**
Mirrors Sony's 12 TONE ANALYSIS concept: continuous scores on 12 perceptual
tone axes, then a separately versioned mapping from axes to channels.
Channels stay interpretable and weights evolve independently of features.

### Stage A — decode and normalize (sensme-audio)

1. Decode with **symphonia** (pure Rust: MP3, FLAC, OGG, M4A, WAV; SSE/AVX/NEON SIMD).
2. Downmix to mono, resample to **22 050 Hz** (standard MIR practice; ~4× cheaper than 44.1 kHz, no perceptible loss for features) via **rubato**.
3. Peak-normalize; compute loudness stats (RMS, dynamic range) before normalization.
4. One shared **STFT stage** (rustfft; Hann window, 2048 frame / 512 hop at 22.05 kHz) feeds all spectral features. Never decode twice.

### Stage B — feature extraction (sensme-audio)

| Feature group | Method | Notes |
|---|---|---|
| BPM, tempo stability, beat strength | Spectral-flux onset detection + DP beat tracking (Ellis 2007 style) | Implemented in-house; no mature pure-Rust crate exists (ADR-004) |
| Rhythm regularity, onset density | Onset envelope autocorrelation + inter-onset-interval stats | Feeds danceability |
| Energy / intensity | RMS distribution, dynamic range, onset strength | |
| Brightness | Spectral centroid, rolloff, flatness, band-energy ratios | |
| Acousticness proxy | High-frequency energy ratio, flatness, HPSS harmonic/percussive balance | |
| Instrumentalness / vocal proxy | Harmonic-percussive source separation; harmonic salience; spectral gaps typical of voice | v1 proxy, iterate via benchmark |
| Valence proxy | Chroma (12-bin) → major/minor mode confidence, mode stability | v1 proxy, iterate via benchmark |
| Timbre | MFCC (20) statistics: mean, variance, covariance diagonal | |

All features are stored as a **versioned, normalized feature vector**
(`feature_vector_version`) in SQLite. `f32` throughout the analysis path.

### Stage C — tone axes (sensme-classify, `axes` module)

12 tone axes (working set, to be validated in Phase 3 benchmarking):
Energetic, Excited, Groovy, Danceable, Sensual, Sweet, Bittersweet, Mellow,
Dreamy, Chillout, Tough, Aggressive.

Each axis is a weighted, differentiable-in-weights function of the feature
vector. Weights live in versioned config (`weights_version`), not code.

### Stage D — channels (sensme-classify, `channels` module)

Channels: Energetic, Relax, Upbeat, Mellow, Lounge, Emotional, Dance,
Extreme, Morning, Daytime, Evening, Night, Midnight.

- Mood channels score from tone-axis profiles (multidimensional scoring —
  **never BPM thresholds alone**).
- Time-of-day channels combine tone axes with a time component (local clock
  at playback/selection time; e.g. Morning favors calm + bright + moderate
  energy, Midnight favors low energy + dark timbre).
- A track gets a score per channel; assignment is top-N by score with a
  minimum-score floor. Scores are exposed to the UI (channel strength
  visualization).

## 4. Persistence (sensme-core)

SQLite (rusqlite, bundled). Core schema (evolves via migrations):

- `tracks` — path, mtime, size, tags (title/artist/album/genre/year, from lofty), artwork ref
- `analyses` — track_id, `algorithm_version`, `feature_vector_version`, feature vector (BLOB, serde), timing stats
- `classifications` — track_id, `weights_version`, per-axis scores, per-channel scores
- `channels` — static channel definitions + user blocklist
- `bench_labels` — imported reference labels (Sony-era exports, manual labels)

**Decision — re-classify never re-decodes.** Classification reads stored
feature vectors only. This makes the calibration loop (Phase 3) instant.

## 5. Cross-platform strategy

- **Parity by construction:** pure-Rust core, no C deps in the analysis path,
  f32 determinism, golden feature vectors in `fixtures/` compared with
  tolerance ±1e-4 on x86-64 and aarch64 in CI.
- **Desktop:** Tauri 2; core called directly (Rust in-process); playback via rodio/cpal.
- **Mobile:** React Native; core exposed via UniFFI (Kotlin/Swift bindings);
  playback via platform players (ExoPlayer/AVPlayer) — analysis never touches the playback path.
  File access via SAF (Android) / security-scoped URLs (iOS), abstracted behind a `LibrarySource` trait in the shell layer.
- **Web:** core → WASM; decode via symphonia in WASM; File System Access API for library.
- **Analysis on mobile:** background worker, resumable queue, 22.05 kHz mono streaming decode (never full-file RAM).

## 6. UI fidelity layer

**Decision — shared tokens, not shared components.** Tauri React, RN, and web
implement the same `docs/UI_SPEC.md` (PSP reference spec) independently,
consuming identical values from `contracts/design-tokens/` (palette, type
scale, spacing grid, easing + durations measured from PSP recordings).
Component abstraction across Tauri/RN was rejected as premature.

Fidelity gate per screen: layout, color, typography, icons, animation timing,
behavior — reviewed against `docs/UI_REFERENCES/`. See AGENTS.md §6.

IP: clean-room asset reimplementation only; provenance log mandatory. ADR-013.

## 7. Data flow (happy path)

```
scan → tags (lofty) → decode+features (sensme-audio, versioned) → SQLite
     → axes+channels (sensme-classify, versioned weights) → SQLite
     → UI channel list → artwork browsing → playback (shell player)
```

## 8. Testing strategy

- Unit tests per extractor with synthetic signals (sine, chirp, click trains with known BPM).
- Golden feature vectors on real fixture audio (CC-licensed tracks) per platform target.
- Classifier snapshot tests: fixed vectors → axis/channel scores.
- Bench reports as regression evidence for classifier changes.
- UI: visual regression screenshots vs. spec; animation timing via test hooks.

## 9. Known risks

| Risk | Mitigation |
|---|---|
| Mobile decode performance | NEON paths, 22.05 kHz mono, streaming, resumable queue |
| Float non-determinism across arches | f32, golden vectors ±1e-4 in CI |
| No Sony ground truth | benchmark = directional evidence; manual labels supplement |
| Vocal/valence accuracy | honest v1 proxies, versioned iteration via bench |
| UniFFI↔RN bridge friction | spike in Phase 2, not Phase 5 |
| C toolchain absent on dev box | install build-essential (needed for rusqlite bundled) |
