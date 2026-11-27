//! Agreement metrics: per-channel precision/recall/F1, top-channel
//! confusion matrix, and score-bias (systematic-error) report.

use std::collections::BTreeMap;

use moodwave_core::models::{Channel, ChannelScores, FeatureVector};

use crate::dataset::{BenchError, Dataset};

/// Per-channel binary agreement at score threshold 0.5.
#[derive(Debug, Clone)]
pub struct ChannelMetrics {
    pub channel: Channel,
    pub tp: u32,
    pub fp: u32,
    pub fn_: u32,
    pub tn: u32,
    pub precision: f64,
    pub recall: f64,
    pub f1: f64,
    /// Labeled positives for this channel.
    pub support: u32,
    /// Mean predicted score on labeled positives / negatives.
    pub mean_pos_score: f64,
    pub mean_neg_score: f64,
}

/// Top-channel confusion counts: (true single label, argmax prediction).
pub type Confusion = BTreeMap<(String, String), u32>;

/// Full evaluation result for one dataset against one classifier.
#[derive(Debug, Clone)]
pub struct BenchReport {
    pub dataset: String,
    pub provenance: String,
    pub n_tracks: usize,
    pub weights_version: String,
    pub per_channel: Vec<ChannelMetrics>,
    pub macro_precision: f64,
    pub macro_recall: f64,
    pub macro_f1: f64,
    pub confusion: Confusion,
    /// Tracks with exactly one positive label (confusion-matrix scope).
    pub n_single_label: u32,
}

/// Evaluate `dataset` with `classify` (features → channel scores).
///
/// # Errors
/// [`BenchError::Analysis`] if a track needs decoding and decoding fails.
pub fn evaluate(
    dataset: &Dataset,
    classify: &dyn Fn(&FeatureVector) -> Result<ChannelScores, BenchError>,
) -> Result<BenchReport, BenchError> {
    // scores[track][channel-index]
    let mut scores: Vec<Vec<f32>> = Vec::with_capacity(dataset.tracks.len());
    let mut weights_version = String::new();
    for t in &dataset.tracks {
        let fv = t.features.as_ref().ok_or_else(|| {
            BenchError::Analysis(format!(
                "track {} needs audio decoding ({:?}); feature vectors are the supported path",
                t.id, t.audio
            ))
        })?;
        let cs = classify(fv)?;
        if weights_version.is_empty() {
            weights_version = cs.weights_version.clone();
        }
        scores.push(cs.scores.to_vec());
    }

    let mut per_channel = Vec::new();
    let mut confusion: Confusion = BTreeMap::new();
    let mut n_single_label = 0u32;

    for (ci, channel) in Channel::ALL.iter().enumerate() {
        let (mut tp, mut fp, mut fn_, mut tn) = (0, 0, 0, 0);
        let (mut sum_pos, mut sum_neg) = (0.0f64, 0.0f64);
        for (t, sc) in dataset.tracks.iter().zip(scores.iter()) {
            if let Some(&pos) = t.labels.get(channel.id()) {
                let pred = sc[ci] >= 0.5;
                match (pos, pred) {
                    (true, true) => tp += 1,
                    (true, false) => fn_ += 1,
                    (false, true) => fp += 1,
                    (false, false) => tn += 1,
                }
                if pos {
                    sum_pos += sc[ci] as f64;
                } else {
                    sum_neg += sc[ci] as f64;
                }
            }
        }
        let support = tp + fn_;
        let n_neg = fp + tn;
        let precision = if tp + fp > 0 {
            tp as f64 / (tp + fp) as f64
        } else {
            0.0
        };
        let recall = if support > 0 {
            tp as f64 / support as f64
        } else {
            0.0
        };
        let f1 = if precision + recall > 0.0 {
            2.0 * precision * recall / (precision + recall)
        } else {
            0.0
        };
        per_channel.push(ChannelMetrics {
            channel: *channel,
            tp,
            fp,
            fn_,
            tn,
            precision,
            recall,
            f1,
            support,
            mean_pos_score: if support > 0 {
                sum_pos / support as f64
            } else {
                0.0
            },
            mean_neg_score: if n_neg > 0 {
                sum_neg / n_neg as f64
            } else {
                0.0
            },
        });
    }

    // Confusion matrix over tracks with exactly one positive label.
    for (t, sc) in dataset.tracks.iter().zip(scores.iter()) {
        let positives: Vec<&String> = t
            .labels
            .iter()
            .filter(|(_, v)| **v)
            .map(|(k, _)| k)
            .collect();
        if positives.len() != 1 {
            continue;
        }
        n_single_label += 1;
        let argmax = sc
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(i, _)| Channel::ALL[i].id().to_string())
            .unwrap_or_default();
        *confusion.entry((positives[0].clone(), argmax)).or_insert(0) += 1;
    }

    let scored: Vec<&ChannelMetrics> = per_channel.iter().filter(|m| m.support > 0).collect();
    let avg = |f: fn(&ChannelMetrics) -> f64| -> f64 {
        if scored.is_empty() {
            0.0
        } else {
            scored.iter().copied().map(f).sum::<f64>() / scored.len() as f64
        }
    };

    Ok(BenchReport {
        dataset: dataset.name.clone(),
        provenance: dataset.provenance.clone(),
        n_tracks: dataset.tracks.len(),
        weights_version,
        macro_precision: avg(|m| m.precision),
        macro_recall: avg(|m| m.recall),
        macro_f1: avg(|m| m.f1),
        per_channel,
        confusion,
        n_single_label,
    })
}

impl BenchReport {
    /// Human-readable report (docs/BENCHMARK_FORMAT.md §Metrics).
    pub fn render(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!(
            "# Bench report: {} ({} tracks, weights {})\n",
            self.dataset, self.n_tracks, self.weights_version
        ));
        out.push_str(&format!("provenance: {}\n\n", self.provenance));
        out.push_str(&format!(
            "{:<11} {:>4} {:>4} {:>4} {:>4} {:>6} {:>6} {:>6} {:>7} {:>7}\n",
            "channel", "tp", "fp", "fn", "tn", "prec", "rec", "f1", "posμ", "negμ"
        ));
        for m in &self.per_channel {
            out.push_str(&format!(
                "{:<11} {:>4} {:>4} {:>4} {:>4} {:>6.2} {:>6.2} {:>6.2} {:>7.2} {:>7.2}\n",
                m.channel.id(),
                m.tp,
                m.fp,
                m.fn_,
                m.tn,
                m.precision,
                m.recall,
                m.f1,
                m.mean_pos_score,
                m.mean_neg_score
            ));
        }
        out.push_str(&format!(
            "\nmacro: precision {:.3}  recall {:.3}  F1 {:.3}\n",
            self.macro_precision, self.macro_recall, self.macro_f1
        ));
        out.push_str(&format!(
            "\ntop-channel accuracy: {}/{} single-label tracks\n",
            self.confusion
                .iter()
                .filter(|((t, p), _)| t == p)
                .map(|(_, n)| *n)
                .sum::<u32>(),
            self.n_single_label
        ));
        let mut pairs: Vec<(&String, &String, u32)> = self
            .confusion
            .iter()
            .filter(|((t, p), _)| t != p)
            .map(|((t, p), n)| (t, p, *n))
            .collect();
        pairs.sort_by_key(|(_, _, n)| std::cmp::Reverse(*n));
        if !pairs.is_empty() {
            out.push_str("top confusions (true -> predicted, count):\n");
            for (t, p, n) in pairs.iter().take(10) {
                out.push_str(&format!("  {t} -> {p}: {n}\n"));
            }
        }
        out
    }

    /// Channels with weak agreement (F1 < 0.5 with support) — candidate
    /// systematic-error classes for follow-up issues.
    pub fn systematic_error_classes(&self) -> Vec<String> {
        let mut v = Vec::new();
        for m in &self.per_channel {
            if m.support > 0 && m.f1 < 0.5 {
                v.push(format!(
                    "channel {} weak agreement (F1 {:.2}, recall {:.2})",
                    m.channel.id(),
                    m.f1,
                    m.recall
                ));
            }
        }
        let mut pairs: Vec<(&String, &String, u32)> = self
            .confusion
            .iter()
            .filter(|((t, p), _)| t != p)
            .map(|((t, p), n)| (t, p, *n))
            .collect();
        pairs.sort_by_key(|(_, _, n)| std::cmp::Reverse(*n));
        for (t, p, n) in pairs.into_iter().take(5) {
            if n >= 3 {
                v.push(format!("confusion class: {t} misread as {p} ({n} tracks)"));
            }
        }
        for m in &self.per_channel {
            if m.support > 0 && m.mean_neg_score > 0.6 {
                v.push(format!(
                    "channel {} over-scores negatives (mean {:.2})",
                    m.channel.id(),
                    m.mean_neg_score
                ));
            }
        }
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dataset::TrackRecord;
    use moodwave_core::models::FeatureVector;

    fn fv(v: f32) -> FeatureVector {
        FeatureVector {
            algorithm_version: "0.1.0".into(),
            feature_vector_version: 1,
            values: vec![v; 30],
        }
    }

    fn labeled(id: &str, pos: &[Channel], neg: &[Channel]) -> TrackRecord {
        let mut labels = BTreeMap::new();
        for c in pos {
            labels.insert(c.id().to_string(), true);
        }
        for c in neg {
            labels.insert(c.id().to_string(), false);
        }
        TrackRecord {
            id: id.into(),
            features: Some(fv(0.5)),
            audio: None,
            labels,
        }
    }

    fn dataset(tracks: Vec<TrackRecord>) -> Dataset {
        Dataset {
            format_version: 1,
            name: "unit".into(),
            created: "2026-11-25".into(),
            provenance: "unit test".into(),
            label_scale: "binary".into(),
            tracks,
        }
    }

    // Classifier: dance=1.0, relax=0.0, everything else 0.5 (>= threshold).
    fn fake_classify(_fv: &FeatureVector) -> Result<ChannelScores, BenchError> {
        let mut scores = [0.5f32; 13];
        scores[Channel::ALL
            .iter()
            .position(|c| *c == Channel::Dance)
            .unwrap()] = 1.0;
        scores[Channel::ALL
            .iter()
            .position(|c| *c == Channel::Relax)
            .unwrap()] = 0.0;
        Ok(ChannelScores {
            scores,
            weights_version: "fake".into(),
        })
    }

    #[test]
    fn per_channel_metrics_are_correct() {
        let ds = dataset(vec![
            labeled("t1", &[Channel::Dance], &[Channel::Relax]),
            labeled("t2", &[Channel::Dance], &[Channel::Relax]),
            labeled("t3", &[Channel::Relax], &[Channel::Dance]),
        ]);
        let r = evaluate(&ds, &fake_classify).unwrap();
        let dance = r
            .per_channel
            .iter()
            .find(|m| m.channel == Channel::Dance)
            .unwrap();
        // t1,t2 positive+predicted; t3 negative+predicted(fp)
        assert_eq!((dance.tp, dance.fp, dance.fn_, dance.support), (2, 1, 0, 2));
        let relax = r
            .per_channel
            .iter()
            .find(|m| m.channel == Channel::Relax)
            .unwrap();
        // t1,t2 negative+not-predicted(tn); t3 positive+not-predicted(fn)
        assert_eq!((relax.tp, relax.fp, relax.fn_, relax.tn), (0, 0, 1, 2));
        assert_eq!(r.weights_version, "fake");
    }

    #[test]
    fn confusion_counts_argmax_mismatches() {
        let ds = dataset(vec![labeled("t1", &[Channel::Relax], &[])]);
        let r = evaluate(&ds, &fake_classify).unwrap();
        assert_eq!(r.n_single_label, 1);
        // argmax is dance (1.0); true label relax
        assert_eq!(
            *r.confusion.get(&("relax".into(), "dance".into())).unwrap(),
            1
        );
        assert!(r.render().contains("relax -> dance"));
    }

    #[test]
    fn macro_averages_only_scored_channels() {
        let ds = dataset(vec![labeled("t1", &[Channel::Dance], &[])]);
        let r = evaluate(&ds, &fake_classify).unwrap();
        // Only dance has support; precision 1.0 recall 1.0.
        assert!((r.macro_f1 - 1.0).abs() < 1e-9);
    }

    #[test]
    fn systematic_errors_flag_weak_channels() {
        let ds = dataset(vec![labeled("t1", &[Channel::Relax], &[])]);
        let r = evaluate(&ds, &fake_classify).unwrap();
        let classes = r.systematic_error_classes();
        assert!(classes.iter().any(|s| s.contains("relax")));
    }
}
