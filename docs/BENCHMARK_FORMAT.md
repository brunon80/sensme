# Benchmark dataset format (v1)

Datasets measure how classifier outputs agree with reference labels.
Per AGENTS.md §4, reference labels are **directional evidence, not ground
truth** — every dataset must record its provenance honestly.

## Layout

Datasets live in `bench/datasets/*.json`, UTF-8 JSON:

```json
{
  "format_version": 1,
  "name": "synthetic-v1",
  "created": "2026-11-25",
  "provenance": "Self-generated synthetic clips; labels by construction.",
  "label_scale": "binary",
  "tracks": [
    {
      "id": "dance-001",
      "features": { "algorithm_version": "0.1.0", "feature_vector_version": 1, "values": [ ...30 f32... ] },
      "labels": { "dance": true, "energetic": false }
    }
  ]
}
```

## Rules

- **Provenance is mandatory.** Free text stating where the audio and the
  labels came from (synthetic / manual listening / community / imported
  from a named product export). Datasets without provenance are rejected.
- **Features are preferred over audio.** If `features` is present (a v1
  feature vector produced by a recorded `algorithm_version`), the bench
  runs without touching audio — fast and reproducible. If absent, `audio`
  (a path relative to the repo) is analyzed at bench time with the
  current pipeline; the report then records the algorithm version used.
- **Labels are per-channel booleans** (`label_scale: "binary"`), keyed by
  channel id (`energetic`, `relax`, …, `midnight`). Channels a track is
  not labeled for are excluded from that track's metrics — partial
  labeling is expected (e.g. time-of-day channels are often unlabeled).
- **Never mutate a committed dataset in place.** Corrections create a new
  dataset file (name bump); the old one stays for delta comparison.
- **No copyrighted audio committed.** Audio fixtures, when used, must be
  self-generated or CC-licensed, noted in provenance.

## Metrics produced by `sensme bench`

- Per-channel precision / recall / F1 at score threshold 0.5, plus
  macro-average.
- Top-channel confusion matrix (predicted argmax vs. the single positive
  label, for tracks with exactly one positive label).
- Systematic-error report: per-channel score bias (mean score on labeled
  positives vs. negatives), and flagged classes of failure.

## Current datasets

| dataset | tracks | provenance |
|---|---|---|
| `bench/datasets/synthetic-v1.json` | 216 | Self-generated synthetic clips rendered deterministically in code (`sensme-bench` generator); labels are by-construction intent labels, **not** human listening labels. Useful as a regression/calibration harness; weak evidence for real-world channel semantics. |
