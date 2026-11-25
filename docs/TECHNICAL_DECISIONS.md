# Technical Decisions (ADR log)

Format: ID, status, date, decision, rationale, consequences. Newest first is
NOT used — append only. Superseding an ADR adds a new ADR that names the old
one as superseded; never rewrite history.

---

## ADR-001 — Rust core engine, single codebase for all platforms
Status: accepted — 2026-11-25

Decision: All analysis, classification, library and persistence logic in a
Rust workspace; shells (Tauri, React Native, web) are thin.

Rationale: Native performance for DSP; one implementation guarantees
identical classification everywhere; Rust's mobile/WASM targets are mature.

Consequences: FFI layers needed (UniFFI, wasm-bindgen); team must maintain
Rust toolchain targets per platform.

## ADR-002 — Symphonia for decoding (no ffmpeg)
Status: accepted — 2026-11-25

Decision: symphonia 0.6.x (pure Rust) decodes MP3/FLAC/OGG/M4A/WAV/CAF.

Rationale: No C dependency → compiles for Android, iOS, WASM unchanged;
SSE/AVX/NEON SIMD paths; MPL-2.0 compatible with our licensing plan;
verified actively maintained (0.6.1, Aug 2026).

Consequences: No APE/WavPack/Monkey's Audio initially; codec gaps added via
optional features or later ADR.

## ADR-003 — rustfft + fundsp + rubato for DSP
Status: accepted — 2026-11-25

Decision: rustfft 6.x as FFT backbone; fundsp 0.23 for filters/windows/DSP
utilities; rubato 5.x for resampling.

Rationale: All pure Rust, actively maintained, widely deployed. One shared
STFT stage feeds all spectral features.

Consequences: Analysis fixed at f32; SIMD hand-optimization deferred until
profiling demands it.

## ADR-004 — In-house tempo/beat tracking
Status: accepted — 2026-11-25

Decision: Implement spectral-flux onset detection + dynamic-programming beat
tracking (Ellis 2007 style) in `sensme-audio`.

Rationale: No mature pure-Rust crate exists (aubio bindings stale, require
C). The algorithm is well documented (~500 LOC) and is core IP for a
music-intelligence product.

Consequences: We own accuracy risk; mitigated by synthetic click-track tests
(±2 BPM gate) and benchmark iteration.

## ADR-005 — lofty for audio tags
Status: accepted — 2026-11-25

Decision: lofty 0.25 for ID3/Vorbis/MP4/M4A/APE tag reading.

Rationale: One crate covers all tag families we need; actively maintained;
pure Rust.

## ADR-006 — SQLite via rusqlite (bundled)
Status: accepted — 2026-11-25

Decision: rusqlite 0.43 with `bundled` SQLite.

Rationale: Offline-first local store; battle-tested; bundled build avoids
system SQLite variance.

Consequences: Requires a C compiler at build time (dev box needs
`build-essential`). WASM target will need a sqlite-wasm strategy in Phase 5 —
open item, separate ADR then.

## ADR-007 — UniFFI for mobile bindings
Status: accepted — 2026-11-25

Decision: uniffi 0.32 generates Kotlin/Swift bindings for the core.

Rationale: Actively maintained (7M recent downloads), used at scale,
type-safe bindings from one interface definition.

Consequences: Interface definition maintenance burden; RN bridge layer
(Turbo Module) still required — de-risked by a Phase 2 spike.

## ADR-008 — Tauri 2 for desktop; React Native (not Tauri Mobile) for mobile
Status: accepted — 2026-11-25

Decision: Desktop shells use Tauri 2. Mobile uses React Native despite Tauri
2 supporting iOS/Android.

Rationale: RN has superior media libraries (ExoPlayer/AVPlayer bridges),
store tooling, and native input control needed for PSP-style navigation;
Tauri Mobile would add risk without benefit.

Consequences: Two UI stacks (React for Tauri/web, RN for mobile) sharing
contracts and design tokens, not components.

## ADR-009 — wasm-bindgen for the web core
Status: accepted — 2026-11-25

Decision: Compile the core to WASM via wasm-bindgen; decode in-browser with
symphonia; library via File System Access API.

Rationale: Same engine, zero server dependency. Web is secondary priority.

Consequences: WASM binary size and SQLite-in-WASM are open engineering items
for Phase 5.

## ADR-010 — ts-rs for shared TypeScript contracts
Status: accepted — 2026-11-25

Decision: Generate TypeScript types from Rust models with ts-rs 12;
generated files live in `contracts/generated/` and are never hand-edited.

Rationale: Single source of truth for data models across all shells.

## ADR-011 — Two-stage classification: features → 12 tone axes → channels
Status: accepted — 2026-11-25

Decision: Continuous scores on 12 perceptual tone axes (working set:
Energetic, Excited, Groovy, Danceable, Sensual, Sweet, Bittersweet, Mellow,
Dreamy, Chillout, Tough, Aggressive), then a separately versioned mapping to
the 13 channels. Time-of-day channels combine axes with a time component.

Rationale: Mirrors Sony's 12 TONE ANALYSIS concept; keeps channels
interpretable; lets axis functions and channel weights evolve independently;
avoids BPM-threshold classification.

Consequences: Axis set is a hypothesis — Phase 3 benchmarking may rename or
merge axes (new ADR if so).

## ADR-012 — Versioned analysis pipeline and weights
Status: accepted — 2026-11-25

Decision: Every analysis record stores `algorithm_version` +
`feature_vector_version`; every classification stores `weights_version`.
Released versions are immutable; semantic changes bump versions.

Rationale: Enables benchmarking across algorithm generations, incremental
re-analysis, and honest regression reports.

## ADR-013 — Clean-room UI assets; design tokens as the fidelity layer
Status: accepted — 2026-11-25

Decision: PSP interface is the source of truth for UI. Sony assets are study
references only and never shipped; all shipped assets are clean-room
reimplementations with provenance recorded in
`docs/UI_REFERENCES/PROVENANCE.md`. Visual values (palette, type, spacing,
easing/durations) live in `contracts/design-tokens/` consumed by every shell.

Rationale: Legal safety (no Sony trademarks/copyrighted assets in
distribution); identical visual identity across six platforms without shared
component code.

Consequences: Typography must match PSP metrics using an open font (choice
deferred to Phase 4b ADR); product naming vs. the "SensMe" trademark is an
open legal question tracked as a Phase 4 risk.

## ADR-014 — No shared UI component library (for now)
Status: accepted — 2026-11-25

Decision: Tauri React, React Native, and web implement `docs/UI_SPEC.md`
independently; only tokens and contracts are shared.

Rationale: Cross-stack component abstraction (RN + DOM) is a known trap; the
spec + tokens give fidelity without coupling.

Consequences: Three implementations of each screen; mitigated by the shared
fidelity checklist and visual regression suite.

## ADR-015 — Analysis at 22 050 Hz mono
Status: accepted — 2026-11-25

Decision: Decode → mono → resample to 22.05 kHz before feature extraction.

Rationale: Standard MIR practice; ~4× cheaper than 44.1 kHz with no
perceptible feature loss (Nyquist 11 kHz covers all features used); critical
for mobile battery/CPU.

Consequences: Any future feature needing >11 kHz content (e.g., hiss/air
analysis) requires a second higher-rate pass — new ADR then.

## ADR-016 — Web-first shell; wasm core; IndexedDB persistence
Status: accepted — 2026-11-25 (product owner decision)

Decision: Phase 4 ships the web app first: React shell + `sensme-wasm`
(wasm-bindgen surface over sensme-audio/classify/core models). Audio is
decoded in wasm from bytes (symphonia is pure Rust); playback uses Web
Audio; the library persists in IndexedDB storing the same versioned
feature/classification records as SQLite. Tauri desktop (Phase 5) embeds
the same React UI with the native rusqlite/rodio backend.

Rationale: One UI implementation proves the PSP fidelity before platform
packaging exists; the web build is the cheapest to iterate and demo;
Tauri then reuses it wholesale. rusqlite (bundled C SQLite) does not
target browsers, so the web shell owns persistence behind the same
versioned-record contract (classification stays a pure function of
stored features on every platform).

Consequences: Two persistence backends (SQLite, IndexedDB) with one
record contract — covered by shared contract tests over exported ts-rs
types; wasm determinism is gated by running the golden-vector suite on
wasm32-unknown-unknown in CI.
