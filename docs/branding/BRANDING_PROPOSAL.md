# Branding Proposal — new name and logo

Status: **decided — Moodwave + wave-bars mark (ADR-020, 2026-11-27)**
Date: 2026-11-27

## Why rename

The working name **SensMe** is Sony's trademark ("SensMe Channels", PSP,
2009). Per `AGENTS.md` §7, "SensMe" may only appear in nominative descriptive
text ("inspired by Sony's SensMe"). A shippable product needs its own brand:
a distinct name and clean-room logo, while the UI keeps its PSP-faithful
visual model (§5 is about experience fidelity, not brand identity).

## Brand essence (what the name must carry)

- Music library → analyzed → **split into color-coded mood/time channels**
  (12 channels, rainbow dot palette in `contracts/design-tokens/tokens.json`).
- Mood, tone, spectrum, flow, water/wave motif of the PSP UI.
- Offline, personal, calm, nostalgic-but-clean aesthetic.

Strongest metaphor: **a prism splitting white light into a spectrum** —
the engine splits a library into a spectrum of colored mood channels.

## Name candidates

| Name | Rationale | Risks |
|---|---|---|
| **Moodwave** (recommended) | Mood (channels) + wave (audio waveform, water wave, "wave of feeling"). Matches the waterline motif of the PSP UI. Descriptive, easy to say/spell, ownable compound. | Needs trademark clearance; check domain/app-store availability. |
| **Kaleido** | Kaleidoscope: library fragments arranged into colored mood patterns. Memorable, playful, matches the rainbow palette. | Crowded namespace (several "Kaleido" products). |
| **Auralight** | "Aural" (hearing) + "light" (prism metaphor: sound refracted into color). Elegant, distinctive. | Slightly abstract; less literal. |
| **Spectra** | Spectrum of tone axes; channels as color bands. | Very crowded across software/hardware brands. |
| **Chromatone** | Color + tone; channels are literally color-coded. | Existing lighting brand "Chromatone". |

Dropped for clear conflicts: **Resona** (Resona Holdings bank), **Tunecore**,
**Soundwave**, **Sensara** (too close to SensMe — must not echo the mark).

## Logo concepts

Clean-room vector concepts in `docs/branding/concepts/` (dark navy
`#0B0D12` background + dotPalette colors from design tokens; 12 elements =
12 channels). Previews: `*-icon.png` (512px), sources: `*-icon.svg`.
Regenerate previews with `node docs/branding/concepts/render.mjs`.

- `moodwave-icon.svg` — 12 spectrum-ordered bars rising and falling as a
  wave: reads as waveform, spectrum and wave at once.
- `kaleido-icon.svg` — the channel dots of the PSP UI arranged as a
  kaleidoscope rosette (12 outer + 12 inner dots).
- `auralight-icon.svg` — a prism refracting one beam into 12 channel rays.
  ⚠ Note: this composition is close to Pink Floyd's *Dark Side of the Moon*
  cover; risky as a shipped brand mark.

These are exploration concepts. The final icon will be rebuilt as clean
vector SVG (source of truth: `apps/web/public/icon.svg` + `gen-icons.mjs`)
using only design-token colors, per §6 "design tokens are law".

## Legal checklist before shipping the new brand

1. Trademark search (USPTO, EUIPO, TMDN) for the chosen name in class 9/41.
2. Domain + app-store handle availability.
3. Logo is clean-room; record provenance in `docs/UI_REFERENCES/PROVENANCE.md`.
4. Keep nominative references: "inspired by Sony's SensMe" stays allowed;
   the SensMe name never appears in product branding.

## Rename scope (once a name is chosen)

- Crates: `crates/sensme-*` → `<new>-*` (Cargo.toml names, lib names, imports).
- Workspace: root `package.json` name, `apps/*` package names, Tauri product
  name/identifier, PWA manifest + icons, `contracts/design-tokens` name.
- Docs: README, ARCHITECTURE, ROADMAP (keep nominative "SensMe" mentions).
- `algorithm_version` / `weights_version` strings are internal — may keep or
  migrate; document the choice in `docs/TECHNICAL_DECISIONS.md`.
