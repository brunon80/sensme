// Shared engine types: ts-rs generated contracts + the web library record.
import type { FeatureVector } from "../../../../contracts/generated/FeatureVector";
import type { Classification } from "../../../../contracts/generated/Classification";
import type { Channel } from "../../../../contracts/generated/Channel";

export type { FeatureVector, Classification, Channel };

/** Shape of `contract_meta()` from sensme-wasm. */
export interface ContractMeta {
  algorithmVersion: string;
  featureVectorVersion: number;
  axisWeightsVersion: string;
  channelWeightsVersion: string;
  featureNames: string[];
  toneAxes: string[];
  channels: string[];
}

/** One library record persisted in IndexedDB (ADR-016). Audio bytes live
 * in a separate store; classification is stored, never recomputed at read. */
export interface LibraryRecord {
  id: number;
  /** Path within the imported folder (webkitRelativePath), for display. */
  path: string;
  name: string;
  sizeBytes: number;
  modifiedEpoch: number;
  durationMs: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  /** Embedded artwork bytes (from tags), if any. */
  artwork: Uint8Array | null;
  favourite: boolean;
  blocked: boolean;
  addedEpoch: number;
  featureVector: FeatureVector;
  classification: Classification;
}

/** Channels a track belongs to (score ≥ 0.5 — same threshold as the bench
 * metrics, docs/BENCHMARK_FORMAT.md). */
export function memberChannels(rec: LibraryRecord): Channel[] {
  const ids = ["energetic", "relax", "upbeat", "mellow", "lounge", "emotional",
    "dance", "extreme", "morning", "daytime", "evening", "night", "midnight"] as const;
  return ids.filter((_, i) => (rec.classification.channels.scores[i] ?? 0) >= 0.5) as Channel[];
}

/** Highest-scoring channel; null when no channel reaches the threshold. */
export function topChannel(rec: LibraryRecord): Channel | null {
  let best: Channel | null = null;
  let bestScore = 0.5;
  const ids = ["energetic", "relax", "upbeat", "mellow", "lounge", "emotional",
    "dance", "extreme", "morning", "daytime", "evening", "night", "midnight"] as const;
  ids.forEach((id, i) => {
    const s = rec.classification.channels.scores[i] ?? 0;
    if (s >= bestScore) {
      bestScore = s;
      best = id;
    }
  });
  return best;
}
