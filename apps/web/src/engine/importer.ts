// Folder import: pick files (File System Access API where available,
// `webkitdirectory` input as fallback), analyze via wasm, tag-parse via
// music-metadata (pure JS — lofty is native-only, ADR-016), persist.
import { parseBlob } from "music-metadata";
import { engine } from "./engine";
import { putRecord } from "./library";
import type { LibraryRecord } from "./types";

const AUDIO_EXT = ["mp3", "flac", "ogg", "oga", "m4a", "mp4", "wav", "aac"];

export function isAudioFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && AUDIO_EXT.includes(name.slice(dot + 1).toLowerCase());
}

/** Ask the user for audio files; returns them with display paths. */
export async function pickAudioFiles(): Promise<File[]> {
  const w = window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
  if (typeof w.showDirectoryPicker === "function") {
    const root = await w.showDirectoryPicker();
    const out: File[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      const entries = (dir as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values();
      for await (const entry of entries) {
        if (entry instanceof FileSystemFileHandle && isAudioFile(entry.name)) {
          const file = await entry.getFile();
          out.push(Object.assign(file, { webkitRelativePath: prefix ? `${prefix}/${entry.name}` : entry.name }));
        } else if (entry instanceof FileSystemDirectoryHandle) {
          await walk(entry, prefix ? `${prefix}/${entry.name}` : entry.name);
        }
      }
    };
    await walk(root, "");
    return out;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      resolve(files);
    });
    input.click();
  });
}

export interface ImportProgress {
  done: number;
  total: number;
  current: string;
  errors: number;
}

/** Analyze + persist every file. Returns the number imported. */
export async function importFiles(
  files: File[],
  onProgress: (p: ImportProgress) => void,
): Promise<number> {
  let done = 0;
  let errors = 0;
  for (const file of files) {
    onProgress({ done, total: files.length, current: file.name, errors });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { featureVector, classification } = await engine.analyze(file.name, bytes);
      let title: string | null = null;
      let artist: string | null = null;
      let album: string | null = null;
      let durationMs = 0;
      let artwork: Uint8Array | null = null;
      try {
        const meta = await parseBlob(file, { duration: true });
        title = meta.common.title ?? null;
        artist = meta.common.artist ?? null;
        album = meta.common.album ?? null;
        durationMs = Math.round((meta.format.duration ?? 0) * 1000);
        const pic = meta.common.picture?.[0];
        artwork = pic ? new Uint8Array(pic.data) : null;
      } catch {
        // Untagged files are fine: display name + no artwork (UI_SPEC §2).
      }
      const rec: LibraryRecord = {
        id: 0,
        path: file.webkitRelativePath || file.name,
        name: file.name,
        sizeBytes: file.size,
        modifiedEpoch: Math.round(file.lastModified / 1000),
        durationMs,
        title,
        artist,
        album,
        artwork,
        favourite: false,
        blocked: false,
        addedEpoch: Math.floor(Date.now() / 1000),
        featureVector,
        classification,
      };
      await putRecord(rec, bytes);
    } catch (err) {
      errors += 1; // surfaced in the status line (UI_SPEC §4 deviation)
      console.error(`import failed: ${file.name}`, err);
    }
    done += 1;
    onProgress({ done, total: files.length, current: file.name, errors });
    // Yield to the event loop so the PSP UI keeps animating.
    await new Promise((r) => setTimeout(r, 0));
  }
  return done - errors;
}
