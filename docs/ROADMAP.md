# SensMe Roadmap

Each phase has a **done gate** — measurable criteria. A phase is not done
until every criterion passes. Phases may overlap where noted.

## Phase 0/1 — Toolchain, architecture, workspace skeleton

Scope: install toolchain, approve architecture, create docs and a buildable
workspace skeleton.

Done gate:
- [x] Architecture approved (docs/ARCHITECTURE.md, ADR log started)
- [x] README.md, AGENTS.md, docs/ present
- [x] Rust stable installed via rustup, pinned in `rust-toolchain.toml`
- [x] C toolchain available (`build-essential`, `pkg-config`)
- [x] `cargo check --workspace && cargo test --workspace` green on skeleton
- [x] git repo initialized, first commit tagged `phase-1`

## Phase 2 — SensMe Core

Scope: decode → features → SQLite → classification v0 → CLI.

Work items:
1. `sensme-audio`: symphonia decode, mono/22.05 kHz resample (rubato), shared STFT stage.
2. Feature extractors (see ARCHITECTURE §3B): tempo/beat tracking, onset
   stats, energy, spectral, chroma/mode, HPSS, MFCC.
3. `sensme-core`: library scan, lofty tags, SQLite schema + migrations, versioned analysis records.
4. `sensme-classify`: tone-axis scoring v0 + channel mapping v0 (hand-tuned weights).
5. `sensme-cli`: `analyze`, `classify`, `library scan`, `export`.
6. UniFFI spike: core callable from a minimal RN screen (de-risked early, not in Phase 5).
7. Golden-vector fixtures: synthetic + real CC-licensed audio; CI on x86-64 + aarch64.

Done gate:
- [x] `sensme analyze <file>` prints a versioned feature vector for MP3/FLAC/OGG/M4A/WAV
- [x] Tempo within ±2 BPM on 20 synthetic click-track fixtures (all common BPMs 60–180)
- [x] ≥100 unit tests passing; golden vectors identical (±1e-4) on x86-64 and aarch64
- [x] `sensme classify` assigns channels from stored vectors without re-decoding
- [ ] UniFFI spike demonstrates typed calls from RN on an Android emulator or device
      (spike done: typed API, Kotlin binding generation, typed calls over JNA on the
      JVM, and aarch64-linux-android cdylib build — see `spike/rn-spike/README.md`;
      emulator/device run pending Phase 5 tooling)

## Phase 3 — Benchmarking and calibration

Scope: reference datasets, agreement metrics, weight tuning.

Work items:
1. `docs/BENCHMARK_FORMAT.md` + `bench/` dataset format (JSON/CSV, provenance required).
2. Importers: Media Go-era exports, manual labels, community labels.
3. `sensme-bench`: per-channel precision/recall/F1, confusion matrix, systematic-error report.
4. Calibration tool: grid/coordinate search over axis weights with bench delta report.
5. Validate the 12 tone-axis working set; rename/merge axes if evidence demands.
6. Classifier v1 with tuned weights.

Done gate:
- [ ] ≥200 labeled tracks in `bench/` with recorded provenance
- [ ] `sensme bench` produces per-channel agreement report vs. reference labels
- [ ] A documented v0→v1 weights change shows measured improvement on the bench
- [ ] Report identifies ≥3 systematic error classes with follow-up issues

## Phase 4 — Application (desktop first, PSP-faithful UI)

Scope: Tauri desktop app implementing the PSP experience.

Sub-phases (gates between each):
- **4a Reference research** *(starts in parallel with Phase 3)*: collect PSP
  screenshots/recordings of every screen into `docs/UI_REFERENCES/` with
  provenance; measure palette, typography, spacing, animation timings.
  Gate: every screen has ≥1 high-quality reference; PROVENANCE.md complete.
- **4b Visual spec**: `docs/UI_SPEC.md` — per-screen layout, tokens,
  interaction flows; `contracts/design-tokens/` generated.
  Gate: spec approved by product owner; tokens package published.
- **4c Implementation**: channel list → artwork browsing → playback loop;
  library management UI; analysis progress UI.
  Gate: full analyze→browse→play loop on Linux.
- **4d Fidelity review**: each screen scored against the checklist (layout,
  color, typography, icons, animation timing, behavior).
  Gate: all screens pass review or have explicit, documented deviations.

Done gate:
- [ ] Windows, Linux, macOS installers build in CI
- [ ] Playback via rodio/cpal with gapless-tolerant queue
- [ ] Visual regression screenshots committed per screen

## Phase 5 — Cross-platform

Scope: React Native mobile, WASM web.

Work items:
1. UniFFI production bindings (Kotlin/Swift) + RN Turbo Module bridge.
2. Platform library sources: SAF (Android), security-scoped URLs (iOS).
3. Background analysis queue (resumable, low-power aware) on mobile.
4. Platform players (ExoPlayer / AVPlayer) behind a shell-level `Player` interface.
5. Web: wasm-bindgen core + File System Access API; PSP UI in React.

Done gate:
- [ ] Golden feature vectors identical (±1e-4) on Android device, iOS device, desktop
- [ ] Full channel→play loop on Android and iOS
- [ ] UI fidelity review passed on mobile (same checklist as 4d)
- [ ] Web app analyzes and plays from a local folder

## Standing quality gates (every commit, all phases)

- `cargo check --workspace && cargo test --workspace` green
- Classifier changes ship with bench delta reports
- UI changes cite their spec section
