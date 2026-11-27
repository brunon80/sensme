// IndexedDB persistence (ADR-016). Two stores: `tracks` holds the record
// with its versioned feature vector + classification; `audio` holds the
// file bytes keyed by id (kept separate so listing a channel never touches
// megabytes). Classification is read back, never recomputed (AGENTS §2).
import type { LibraryRecord } from "./types";

const DB_NAME = "moodwave";
const TRACKS = "tracks";
const AUDIO = "audio";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TRACKS)) {
          db.createObjectStore(TRACKS, { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(AUDIO)) {
          db.createObjectStore(AUDIO);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function putRecord(rec: LibraryRecord, bytes: Uint8Array): Promise<number> {
  // id 0 means "new": omit the key so autoIncrement assigns it (an explicit
  // undefined/0 key is invalid or collides).
  const stored: Partial<LibraryRecord> = { ...rec };
  if (rec.id === 0) delete stored.id;
  const id = await tx<number>(TRACKS, "readwrite", (s) => s.put(stored) as IDBRequest<number>);
  await tx(AUDIO, "readwrite", (s) => s.put(bytes, id) as IDBRequest<IDBValidKey>);
  return id;
}

export function allRecords(): Promise<LibraryRecord[]> {
  return tx<LibraryRecord[]>(TRACKS, "readonly", (s) => s.getAll() as IDBRequest<LibraryRecord[]>);
}

export function getRecord(id: number): Promise<LibraryRecord | undefined> {
  return tx<LibraryRecord | undefined>(TRACKS, "readonly", (s) => s.get(id) as IDBRequest<LibraryRecord | undefined>);
}

export function updateRecord(rec: LibraryRecord): Promise<unknown> {
  return tx(TRACKS, "readwrite", (s) => s.put(rec));
}

export function getAudioBytes(id: number): Promise<Uint8Array | undefined> {
  return tx<ArrayBuffer | undefined>(AUDIO, "readonly", (s) => s.get(id) as IDBRequest<ArrayBuffer | undefined>)
    .then((b) => (b ? new Uint8Array(b) : undefined));
}

export async function clearLibrary(): Promise<void> {
  await tx(TRACKS, "readwrite", (s) => s.clear());
  await tx(AUDIO, "readwrite", (s) => s.clear());
}

export async function countRecords(): Promise<number> {
  return tx<number>(TRACKS, "readonly", (s) => s.count() as IDBRequest<number>);
}
