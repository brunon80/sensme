# contracts

Shared artifacts consumed by every shell:

- `generated/` — TypeScript types generated from Rust models via `ts-rs`
  (never hand-edit; regenerate from `sensme-core`). Populated in Phase 2.
- `design-tokens/` — the PSP fidelity layer: palette, type scale, spacing,
  easing curves and durations measured from PSP references
  (`docs/UI_REFERENCES/`). Populated in Phase 4b.
