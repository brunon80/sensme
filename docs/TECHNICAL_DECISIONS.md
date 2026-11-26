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

## ADR-017 — Web playback through an HTMLMediaElement; Media Session API
Status: accepted — 2026-11-26 (amends the playback detail of ADR-016)

Decision: The web shell plays audio through a hidden `<audio>` element
(blob URL + container MIME from the file extension) instead of a Web Audio
`AudioBufferSourceNode`, and publishes the current track through the Media
Session API (`metadata`, `playbackState`, `positionState`, action handlers
for play/pause/prev/next/stop/seek*).

Rationale: Desktop environments only show now-playing metadata and
transport controls (Windows media overlay/Game Bar, Linux MPRIS over
D-Bus, hardware media keys) for the page that owns the *active media
session*, and browsers only activate that session for a real media
element — a Web-Audio-only page never surfaces (w3c/mediasession #244 and
#378; Firefox bug 2067534). Playback was already browser-native by design
(ADR-016): the analysis path stays deterministic in wasm, so moving the
playback transport costs nothing in fidelity and buys native seeking and
OS integration for free.

Consequences: `Player` keeps its public API (`state`, `onChange`, `play`,
`pause`, `resume`, `toggle`, `stop`, `positionSec`) and gains
`durationSec`/`seek`; the media session lives in
`apps/web/src/engine/mediaSession.ts` and is wired in `App.tsx`. Gated by
`apps/web/scripts/mediasession.mjs` (Chromium: metadata matches the
on-screen title, playback state mirrors the player, OS transport drives
next/prev/pause/play/stop). Firefox supports metadata + action handlers
but not `setPositionState` — the position push is feature-detected and
skipped there. Tauri (Phase 5) gets the same OS integration natively
(rodio + a native media-session layer), so this ADR is web-shell scope
only.

## ADR-018 — Dynamic Normalizer: recovered contract, clean-room algorithm
Status: accepted — 2026-11-26

Decision: Implement the PSP "Dynamic Normalizer" Sound Settings feature as
a per-track static playback gain: the Rust core measures loudness
(peak + RMS over the deterministic mono decode, `sensme-audio::loudness`,
versioned by `LOUDNESS_VERSION`) at analysis time, maps it to a gain
(target RMS 0.10, bounds 0.2–3.0, post-gain peak ceiling 0.99, silence
guard), stores both on the record, and the web shell applies it through a
Web Audio `GainNode` inserted in front of the `<audio>` element
(element → MediaElementSource → Gain → destination), ramping changes over
the original mixer's 71 ms interval (0x70 chunks × 28 samples). The
setting is ON by default and persisted (localStorage; the original used
property.xml).

Rationale: We reverse-engineered the original EBOOT for this feature
(full report: `docs/RE_DYNAMIC_NORMALIZER.md`). Findings: the audible
normalizer is NOT implemented in the EBOOT — it lives inside Sony's
closed firmware codec libraries. What the EBOOT *does* give us is the
contract: a per-track loudness scalar computed during analysis (the DB's
`pcsd` column stores only its presence flag), an ON/OFF setting defaulting
to ON, and a bit-exact software mixer whose ramp engine (71 ms gain
ramps) is the designed hook for playback gain. The measurement + gain
mapping are therefore a clean-room design over the recovered contract
(AGENTS §7: concepts reproduced, no copied code); the audible behavior is
ours and labeled as such in code.

Consequences: `AnalysisResult` gains `loudness` + `normalizerGain`
(computed once at analysis; playback never re-decodes — AGENTS §2).
Records imported before this feature have `null` and play at unity until
"Database Settings → Clear and Rebuild" re-analyzes them. The Player
gains `setGain`/`gainValue`; the Media Session integration of ADR-017 is
unaffected (the element still owns the media session — verified by the
mediasession gate). Options menu regains Sound Settings → Dynamic
Normalizer (the previously removed no-op is now real; Sound Effects
stays removed until it does something). Gated by
`apps/web/scripts/normalizer.mjs` (gain applied at play, toggle restores
unity live, setting persists across reload) plus Rust unit tests in
`sensme-audio::loudness`.
