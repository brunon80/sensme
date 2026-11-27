// Metadata enrichment (ADR-019): user-initiated lookup of missing track
// metadata (title / artist / album / artwork / label) against MusicBrainz
// + Cover Art Archive. Network is OPTIONAL and never automatic: the user
// triggers it from the menu, results are cached in the record, and the app
// stays fully offline afterwards (AGENTS §2). Only missing fields are
// filled — existing tags are never overwritten.
import type { LibraryRecord } from "./types";
import { updateRecord } from "./library";

const MB = "https://musicbrainz.org/ws/2";
const CAA = "https://coverartarchive.org";

export interface EnrichProgress {
  done: number;
  total: number;
  current: string;
  errors: number;
  /** Records already complete (no lookup needed). */
  skipped: number;
}

/** True when the record is missing at least one enrichment target. */
export function needsMetadata(r: LibraryRecord): boolean {
  return !r.title || !r.artist || !r.album || !r.artwork || !r.label;
}

/** "Artist - Title" filename convention fallback for untagged files. */
export function parseFileName(name: string): { artist: string | null; title: string } {
  const base = name.replace(/\.[A-Za-z0-9]+$/, "").trim();
  const i = base.indexOf(" - ");
  if (i > 0) return { artist: base.slice(0, i).trim(), title: base.slice(i + 3).trim() };
  return { artist: null, title: base };
}

// ---- minimal MusicBrainz JSON shapes (only the fields we read) ----
interface MbArtistCredit {
  name: string;
}
interface MbReleaseRef {
  id: string;
  title?: string;
  date?: string;
}
interface MbRecording {
  id: string;
  title: string;
  "artist-credit"?: MbArtistCredit[];
  "release-group"?: { id: string };
  releases?: MbReleaseRef[];
}
interface MbSearch {
  recordings: MbRecording[];
}
interface MbRelease {
  id: string;
  title: string;
  date?: string;
  "label-info"?: { "catalog-number"?: string; label?: { name: string } }[];
}

// MusicBrainz usage policy: at most one request per second. We space a
// bit more (1.5 s) — bursts were drawing 523s from their edge — and
// retry transient failures (429/503/523) with growing backoff.
const MB_SPACING_MS = 1500;
let lastMbAt = 0;
async function mbGet(path: string, attempt = 0): Promise<unknown> {
  const wait = MB_SPACING_MS - (Date.now() - lastMbAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastMbAt = Date.now();
  const res = await fetch(`${MB}${path}`, { headers: { Accept: "application/json" } });
  if ((res.status === 429 || res.status === 503 || res.status === 523) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); // 2s, 4s, 6s
    return mbGet(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`musicbrainz ${res.status}: ${path}`);
  return res.json();
}

async function fetchCover(archivePath: string, attempt = 0): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${CAA}${archivePath}`);
    if ((res.status === 429 || res.status === 503 || res.status === 520 || res.status === 522 || res.status === 523) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      return fetchCover(archivePath, attempt + 1);
    }
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export interface MetadataHit {
  title: string | null;
  artist: string | null;
  album: string | null;
  artwork: Uint8Array | null;
  label: string | null;
  catalogNumber: string | null;
  releaseYear: number | null;
}

/** Look up one track. `artist`/`title` come from tags when present, else
 * from the filename convention. Null = nothing found. */
export async function lookupMetadata(artist: string | null, title: string): Promise<MetadataHit | null> {
  const q = [
    title ? `recording:"${title.replace(/"/g, " ")}"` : "",
    artist ? `artist:"${artist.replace(/"/g, " ")}"` : "",
  ]
    .filter(Boolean)
    .join(" AND ");
  if (!q) return null;
  const search = (await mbGet(`/recording/?query=${encodeURIComponent(q)}&limit=5&fmt=json`)) as MbSearch;
  const rec = search.recordings?.[0];
  if (!rec) return null;
  const hit: MetadataHit = {
    title: rec.title || null,
    artist: rec["artist-credit"]?.[0]?.name ?? null,
    album: rec.releases?.[0]?.title ?? null,
    artwork: null,
    label: null,
    catalogNumber: null,
    releaseYear: null,
  };
  const relId = rec.releases?.[0]?.id;
  if (relId) {
    try {
      const rel = (await mbGet(`/release/${relId}?fmt=json&inc=labels`)) as MbRelease;
      hit.album = rel.title || hit.album;
      hit.label = rel["label-info"]?.[0]?.label?.name ?? null;
      hit.catalogNumber = rel["label-info"]?.[0]?.["catalog-number"] ?? null;
      const y = rel.date ? Number(rel.date.slice(0, 4)) : Number.NaN;
      hit.releaseYear = Number.isFinite(y) ? y : null;
      hit.artwork = await fetchCover(`/release/${relId}/front-250`);
    } catch {
      // release detail is best-effort
    }
  }
  if (!hit.artwork && rec["release-group"]?.id) {
    hit.artwork = await fetchCover(`/release-group/${rec["release-group"].id}/front-250`);
  }
  const anything = hit.title || hit.artist || hit.album || hit.artwork || hit.label;
  return anything ? hit : null;
}

/** Fill missing metadata for every incomplete record. Returns the number
 * of records updated. `shouldCancel` (checked before each lookup) aborts. */
export async function enrichMissing(
  records: LibraryRecord[],
  onProgress: (p: EnrichProgress) => void,
  shouldCancel?: () => boolean,
): Promise<number> {
  let done = 0;
  let errors = 0;
  let skipped = 0;
  let updated = 0;
  for (const rec of records) {
    if (shouldCancel?.()) break;
    onProgress({ done, total: records.length, current: rec.name, errors, skipped });
    if (!needsMetadata(rec)) {
      skipped += 1;
      done += 1;
      onProgress({ done, total: records.length, current: rec.name, errors, skipped });
      continue;
    }
    try {
      const parsed = parseFileName(rec.name);
      const hit = await lookupMetadata(rec.artist ?? parsed.artist, rec.title ?? parsed.title);
      if (hit) {
        // Fill missing fields only — existing tags win (the user's own
        // files are the source of truth).
        if (!rec.title && hit.title) rec.title = hit.title;
        if (!rec.artist && hit.artist) rec.artist = hit.artist;
        if (!rec.album && hit.album) rec.album = hit.album;
        if (!rec.artwork && hit.artwork) rec.artwork = hit.artwork;
        if (!rec.label && hit.label) rec.label = hit.label;
        if (rec.catalogNumber === undefined || rec.catalogNumber === null) {
          if (hit.catalogNumber) rec.catalogNumber = hit.catalogNumber;
        }
        if (rec.releaseYear === undefined || rec.releaseYear === null) {
          if (hit.releaseYear) rec.releaseYear = hit.releaseYear;
        }
        rec.metaSource = "musicbrainz";
        await updateRecord(rec);
        updated += 1;
      }
    } catch (err) {
      errors += 1;
      console.error(`metadata lookup failed: ${rec.name}`, err);
    }
    done += 1;
    onProgress({ done, total: records.length, current: rec.name, errors, skipped });
  }
  return updated;
}
