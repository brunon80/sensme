# SensMe

A cross-platform music intelligence and player application — an independent,
modern reimplementation of the spirit and experience of Sony's SensMe Channels
(PlayStation Portable, 2009).

SensMe analyzes your local music library, classifies every track along twelve
perceptual **tone axes**, and organizes it into **mood and time-of-day
channels** (Energetic, Relax, Upbeat, Mellow, Lounge, Emotional, Dance,
Extreme, Morning, Daytime, Evening, Night, Midnight). The UI is a faithful
recreation of the original PSP SensMe Channels application.

- **Offline-first.** No cloud services, no proprietary online APIs.
- **Local library only.** Your files stay on your machine.
- **Cross-platform.** Windows, Linux, macOS, Android, iOS, and (secondary) web.
- **Deterministic engine.** One Rust core compiled everywhere; identical
  analysis results on every platform, guaranteed by golden-vector tests.

## Status

Phase 1 — architecture and workspace skeleton. See [docs/ROADMAP.md](docs/ROADMAP.md).

| Phase | Scope | Status |
|---|---|---|
| 0/1 | Toolchain, architecture, docs, workspace skeleton | in progress |
| 2 | SensMe core: decode → features → SQLite → CLI | planned |
| 3 | Benchmarking and calibration vs. reference labels | planned |
| 4 | Application (Tauri desktop, PSP-faithful UI) | planned |
| 5 | Cross-platform (React Native mobile, WASM web) | planned |

## Repository layout

```
crates/
  sensme-core/        domain models, library management, persistence
  sensme-audio/       decoding, resampling, STFT, feature extraction
  sensme-classify/    tone axes + channel scoring (versioned weights)
  sensme-bench/       reference datasets, agreement metrics, calibration
  sensme-ffi/         UniFFI bindings (Kotlin / Swift)
  sensme-wasm/        wasm-bindgen surface for the web app
  sensme-cli/         `sensme analyze | classify | bench | tune`
apps/
  desktop/            Tauri + React (PSP-faithful UI)
  mobile/             React Native (iOS / Android)
  web/                React + WASM core
contracts/
  generated/          TypeScript types generated from Rust (ts-rs)
  design-tokens/      shared visual identity tokens (PSP fidelity layer)
fixtures/             audio test files + golden feature vectors
bench/                reference classification datasets
docs/                 ARCHITECTURE, ROADMAP, TECHNICAL_DECISIONS, UI_SPEC, UI_REFERENCES
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, analysis pipeline, data model
- [docs/ROADMAP.md](docs/ROADMAP.md) — phases and measurable milestones
- [docs/TECHNICAL_DECISIONS.md](docs/TECHNICAL_DECISIONS.md) — ADR log
- [AGENTS.md](AGENTS.md) — engineering rules for humans and AI agents

## Development prerequisites

- Rust (stable, via [rustup](https://rustup.rs)) — pinned in `rust-toolchain.toml`
- A C compiler (`build-essential` / Xcode CLT / MSVC) — required by bundled SQLite in Phase 2
- Node.js ≥ 22 + pnpm ≥ 9
- Android: NDK + `cargo-ndk` (Phase 5); iOS builds run on macOS CI

## Quick start

```sh
cargo build                 # workspace
cargo test                  # all tests
cargo run -p sensme-cli     # CLI (Phase 2+)
pnpm install                # JS/TS workspaces
```

## Legal

SensMe is an independent implementation. It is not affiliated with, endorsed
by, or containing code or assets from Sony Corporation. Original Sony assets
(icons, fonts, backgrounds) are used only as internal study references and are
never shipped; all shipped visual assets are clean-room reimplementations.
See `docs/UI_REFERENCES/PROVENANCE.md`.
