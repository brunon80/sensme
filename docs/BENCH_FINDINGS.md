# Bench findings — v0 → v1 classifier weights

Date: 2026-11-25. Dataset: `bench/datasets/synthetic-v1.json` (216 tracks,
by-construction intent labels; see provenance in the file and
docs/BENCHMARK_FORMAT.md). Tooling: `moodwave bench` / `moodwave tune`
(`crates/moodwave-bench`).

Per AGENTS.md §4 these numbers are **directional evidence**, not ground
truth: the labels encode synthesis intent, not human listening judgments.

## Method

`moodwave tune` runs coordinate-descent over the 12 axis biases, the sparse
axis feature weights, and the sparse channel→axis weights, maximizing
macro F1 at threshold 0.5 (deltas ±0.07/±0.2/±0.4, up to 5 sweeps). The
tuned weights were rounded to 2 decimals and shipped as weights version
**1.0.0** in `moodwave-classify`; the v0 sets (0.1.0) remain available via
`v0_axis_weights()` / `v0_channel_weights()` for regression comparison.

## Measured delta (per-channel F1, threshold 0.5)

| channel    | v0 prec | v0 rec | v0 F1 | v1 prec | v1 rec | v1 F1 |
|------------|--------:|-------:|------:|--------:|-------:|------:|
| energetic  | 0.50    | 1.00   | 0.67  | 0.96    | 0.93   | 0.94  |
| relax      | 0.00    | 0.00   | 0.00  | 1.00    | 1.00   | 1.00  |
| upbeat     | 1.00    | 1.00   | 1.00  | 1.00    | 1.00   | 1.00  |
| mellow     | 0.00    | 0.00   | 0.00  | 1.00    | 1.00   | 1.00  |
| lounge     | 0.00    | 0.00   | 0.00  | 1.00    | 1.00   | 1.00  |
| emotional  | 1.00    | 1.00   | 1.00  | 1.00    | 1.00   | 1.00  |
| dance      | 0.26    | 1.00   | 0.42  | 0.93    | 0.93   | 0.93  |
| extreme    | 1.00    | 1.00   | 1.00  | 1.00    | 1.00   | 1.00  |
| **macro**  | 0.470   | 0.625  | **0.510** | 0.986 | 0.981 | **0.984** |

What moved: axis biases for the quiet/slow axes (mellow +0.6, chillout
+0.07, groovy −0.6, danceable −0.53), RMS weight on energetic, and the
Dance channel mapping (danceable axis 1.0→0.6, energetic axis 0.7→1.3).

## Systematic error classes (from the v0 report)

1. **Dance over-scores everything.** v0 dance had 76 false positives
   (precision 0.26): the danceable axis fires on any steady beat, so
   mellow/relax/lounge clips crossed 0.5. Fixed in v1 by re-weighting the
   Dance channel map and lowering the danceable axis bias.
2. **Quiet/slow channels never fire.** relax, mellow and lounge had
   recall 0.0 in v0: their axis biases were too low for quiet, slow,
   dark clips to cross the 0.5 threshold. Fixed by bias calibration.
3. **Extreme vs energetic not separated.** 22/27 extreme clips had
   energetic as argmax channel in v0: the aggressive axis under-weighted
   noisiness (HPSS/inharmonicity) relative to loudness+tempo. Improved in
   v1 (extreme precision 1.00); argmax separation still imperfect.
4. **Low top-channel accuracy overall.** v0 argmax was correct for only
   29/216 single-label tracks — channel scores cluster near the top and
   small score differences flip the argmax. Not fixed by weights alone.

## Follow-up issues (open)

- **F-1 Human-labeled dataset.** synthetic-v1 labels are by construction;
  v1 weights are calibrated on them and may overfit. Import/collect
  human listening labels (Media Go-era exports where available, manual
  community labels) and re-validate v1 before Phase 4 defaults.
- **F-2 Time-of-day channels unlabeled.** morning/daytime/evening/night/
  midnight have zero labeled tracks; their tone-profile weights are
  still hand-tuned v0 values. Needs labeled data + the query-time
  time-of-day boost design (ADR-011).
- **F-3 Argmax margin.** Top-channel accuracy 85/216 in v1: add score
  normalization or a margin-based channel selection rule so near-ties
  don't flip (dance→upbeat 25, emotional→lounge 20).
- **F-4 Negative-label coverage.** Each synthetic track carries only 2
  explicit negatives; denser negative labeling would make precision
  estimates stronger.

## Axis working set (Phase 3 item 5)

The 12-axis working set was exercised end-to-end and remains coherent:
every axis responds monotonically to its intended features (unit tests),
and no axis was found redundant or unnameable on this evidence. No
rename/merge this round; revisit after human-labeled data (F-1).
