// App state machine + PSP input mapping (docs/UI_REFERENCES/interaction-model.md).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../../contracts/design-tokens/tokens";
import { engine } from "./engine/engine";
import { allRecords, clearLibrary, getAudioBytes, updateRecord } from "./engine/library";
import { importFiles, pickAudioFiles, rebuildLibrary, type ImportProgress } from "./engine/importer";
import { enrichMissing } from "./engine/metadata";
import {
  registerMediaControls,
  setPlaybackState,
  setTrackMetadata,
  updatePositionState,
  type MediaControls,
} from "./engine/mediaSession";
import { mimeForName, player } from "./engine/player";
import type { ContractMeta, LibraryRecord } from "./engine/types";
import { Carousel } from "./ui/Carousel";
import { carouselGrid, entryHues, entryTracks, shuffledQueue, todForHour, type CarouselEntry } from "./ui/channels";
import { captionsFor, detectPlatform, type ActionId } from "./ui/controls";
import { useMouseDrag, useWheelSteps } from "./ui/mouse";
import { NowPlaying, slotChain } from "./ui/NowPlaying";
import { Options, type Settings } from "./ui/Options";
import { RotateHint } from "./ui/RotateHint";
import { Scene } from "./ui/Scene";
import { useTouchGestures } from "./ui/touch";

type Screen = "boot" | "empty" | "carousel" | "nowplaying";

/** Dynamic Normalizer gain for a record (ADR-018): the static per-track
 * gain computed by the Rust core, or unity when the setting is off / the
 * record predates the measurement. */
function normalizerGainFor(rec: LibraryRecord | null | undefined, s: Settings): number {
  return s.dynamicNormalizer && rec?.normalizerGain != null ? rec.normalizerGain : 1;
}

interface UpdateState {
  active: boolean;
  done: number;
  total: number;
  errors: number;
  skipped: number;
  /** Which operation is running: drives the status wording. */
  kind: "scan" | "rebuild" | "metadata";
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("boot");
  const [meta, setMeta] = useState<ContractMeta | null>(null);
  const [records, setRecords] = useState<LibraryRecord[]>([]);
  const [entryIndex, setEntryIndex] = useState(0);
  // Channel backing now-playing. Browsing the carousel previews other
  // channels' backdrops, but cancelling (✕/Esc) restores this one: the
  // preview must not leak into the now-playing scene (UI_SPEC §1).
  // Stored as the entry itself: the grid is dynamic (time-of-day rollover),
  // so an index into it would not survive a grid change.
  const [npEntry, setNpEntry] = useState<CarouselEntry | null>(null);
  const [hour, setHour] = useState(() => new Date().getHours());
  const [selection, setSelection] = useState(0);
  const [queue, setQueue] = useState<LibraryRecord[]>([]);
  const [queuePos, setQueuePos] = useState(0);
  // Two-step track selection (now-playing): L/R stages a candidate at a
  // smaller scale in the big slot; START/◯ confirms (scales up + plays).
  const [pending, setPending] = useState<number | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ active: false, done: 0, total: 0, errors: 0, skipped: 0, kind: "scan" });
  // Settings persist across sessions (the original stores them in
  // property.xml; we use localStorage). Defaults match the PSP's
  // MenuParam*_DefaultCheck (all ON).
  const [settings, setSettings] = useState<Settings>(() => {
    const defaults: Settings = { showClock: true, showCaptions: true, dynamicNormalizer: true, allDayChannels: false };
    try {
      const raw = localStorage.getItem("moodwave.settings");
      return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) } : defaults;
    } catch {
      return defaults;
    }
  });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    try {
      localStorage.setItem("moodwave.settings", JSON.stringify(settings));
    } catch {
      // Private-mode quota errors must not break the app.
    }
  }, [settings]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [clock, setClock] = useState("");
  const [playing, setPlaying] = useState(false);
  const [prevScreen, setPrevScreen] = useState<Screen>("boot");
  const [transitioning, setTransitioning] = useState(false);
  // The now-playing enter animation (fadeUp) plays on boot/import; when
  // returning from the channel grid the dim transition simply reverses
  // (UI_SPEC §1).
  const [npAnim, setNpAnim] = useState<"enter" | "none">("enter");
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;
  // First-run progress card cancel (UI_SPEC §4: ✕ Cancel).
  const cancelImportRef = useRef(false);
  const queuePosRef = useRef(0);
  queuePosRef.current = queuePos;
  const queueRef = useRef<LibraryRecord[]>([]);
  queueRef.current = queue;

  // The channel grid is dynamic: the time-of-day slot follows the clock,
  // and View Settings → All Day Channels restores all five.
  const grid = useMemo(() => carouselGrid(settings.allDayChannels, hour), [settings.allDayChannels, hour]);
  useEffect(() => {
    if (window.__moodwave) window.__moodwave.grid = grid;
  }, [grid]);
  const entry = grid[Math.min(entryIndex, grid.length - 1)]!.entry;

  // Grid navigation: ←/→ step a column (keeping the row when that column
  // has one), ↑/↓ toggle the row within the column.
  function moveCol(d: number) {
    setEntryIndex((i) => {
      const cur = grid[Math.min(i, grid.length - 1)];
      if (!cur) return i;
      const target = cur.col + d;
      const same = grid.findIndex((c) => c.col === target && c.row === cur.row);
      if (same >= 0) return same;
      const any = grid.findIndex((c) => c.col === target);
      return any >= 0 ? any : i;
    });
  }
  function moveRow(row: 0 | 1) {
    setEntryIndex((i) => {
      const cur = grid[Math.min(i, grid.length - 1)];
      if (!cur) return i;
      const idx = grid.findIndex((c) => c.col === cur.col && c.row === row);
      return idx >= 0 ? idx : i;
    });
  }

  // When the grid changes (time-of-day rollover, All Day Channels toggle)
  // keep the same entry selected if it is still on the grid; otherwise
  // clamp into the new grid.
  const gridRef = useRef(grid);
  const entryIndexRef = useRef(entryIndex);
  entryIndexRef.current = entryIndex;
  useEffect(() => {
    const prev = gridRef.current;
    if (prev === grid) return;
    gridRef.current = grid;
    const e = prev[Math.min(entryIndexRef.current, prev.length - 1)]?.entry;
    const idx = e ? grid.findIndex((c) => c.entry === e) : -1;
    setEntryIndex(idx >= 0 ? idx : Math.min(entryIndexRef.current, grid.length - 1));
  }, [grid]);

  const reload = useCallback(async () => {
    const recs = await allRecords();
    setRecords(recs);
    return recs;
  }, []);

  // Boot: init wasm (contract meta) + load persisted library.
  useEffect(() => {
    void (async () => {
      setMeta(await engine.ready);
      const recs = await reload();
      if (recs.length === 0) {
        setScreen("empty");
        return;
      }
      // The PSP opens on the channel of the moment: land on the current
      // time-of-day channel; if it has no tracks, the first populated entry.
      const hour0 = new Date().getHours();
      const g = carouselGrid(settingsRef.current.allDayChannels, hour0);
      let idx = g.findIndex((c) => c.entry === todForHour(hour0) && entryTracks(c.entry, recs).length > 0);
      if (idx < 0) idx = g.findIndex((c) => entryTracks(c.entry, recs).length > 0);
      if (idx < 0) idx = 0;
      setEntryIndex(idx);
      setNpEntry(g[idx]!.entry);
      setScreen("nowplaying");
      const q = rebuildQueue(g[idx]!.entry, 0, recs);
      // The PSP opens already playing; the autoplay policy may block it
      // (playAt swallows the rejection — START retries).
      if (q.length > 0) void playAt(0, q);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clock furniture (top-right, R-2).
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(`${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`);
      setHour(d.getHours());
    };
    tick();
    const h = setInterval(tick, 5000);
    return () => clearInterval(h);
  }, []);

  // Keep the UI in sync with player state (captions, ▶ tag) and mirror it
  // into the OS media controls (ADR-017).
  useEffect(
    () =>
      player.onChange(() => {
        setPlaying(player.state === "playing");
        setPlaybackState(player.state);
        updatePositionState();
      }),
    [],
  );

  // OS media integration: the playhead is pushed while playing so OS
  // scrubbing UIs follow along (metadata is published below, on `current`).
  useEffect(() => {
    if (!playing) return;
    const h = window.setInterval(() => updatePositionState(), 1000);
    return () => window.clearInterval(h);
  }, [playing]);

  function rebuildQueue(entry: CarouselEntry, sel: number, recs: LibraryRecord[]): LibraryRecord[] {
    const q = shuffledQueue(entry, sel, recs);
    setQueue(q);
    setQueuePos(0);
    return q;
  }

  // Screen navigation with the PSP enter/exit transition (UI_SPEC §1).
  const goScreen = useCallback((to: Screen) => {
    setScreen((cur) => {
      if (cur === to) return cur;
      setPrevScreen(cur);
      setTransitioning(true);
      window.setTimeout(() => setTransitioning(false), tokens.motion.enterNowPlayingMs);
      return to;
    });
  }, []);

  const current = queue[queuePos] ?? null;

  // Dynamic Normalizer (ADR-018): toggling the setting re-applies the gain
  // to the loaded track (the player glides over the PSP ramp interval).
  useEffect(() => {
    player.setGain(normalizerGainFor(current, settings));
  }, [current, settings]);

  // OS media integration (ADR-017): publish the loaded track (title, artist,
  // album, artwork) to the desktop environment's media controls.
  useEffect(() => {
    setTrackMetadata(current);
    setPlaybackState(player.state);
    updatePositionState();
  }, [current]);

  const playAt = useCallback(async (pos: number, q: LibraryRecord[]) => {
    const rec = q[pos];
    if (!rec) return;
    setQueuePos(pos);
    const bytes = await getAudioBytes(rec.id);
    if (!bytes) return;
    // Dynamic Normalizer (ADR-018): static per-track gain from the Rust
    // core, off when the setting is off or the record predates it.
    player.setGain(normalizerGainFor(rec, settingsRef.current));
    try {
      await player.play(bytes, () => void nextIn(q), mimeForName(rec.name));
    } catch {
      // Autoplay policy or decode failure: stay stopped; START retries.
    }
  }, []);

  const nextIn = useCallback((q: LibraryRecord[]) => {
    const pos = queuePosRef.current;
    const np = pos + 1;
    if (np < q.length) void playAt(np, q); // end of queue: stop, don't loop
  }, [playAt]);

  // OS transport (ADR-017): hardware keys and DE media buttons map onto the
  // same actions as the PSP controls, with two hardware-key conventions:
  // next/prev skip immediately (no L/R candidate staging — an OS request
  // means "now"), and prev restarts the track when we are mid-playback.
  useEffect(() => {
    const ctl: MediaControls = {
      play: () => {
        if (player.state === "playing") return;
        if (player.state === "paused") player.resume();
        else void playAt(queuePosRef.current, queueRef.current);
      },
      pause: () => player.pause(),
      next: () => {
        const q = queueRef.current;
        const np = queuePosRef.current + 1;
        if (np < q.length) void playAt(np, q);
      },
      prev: () => {
        if (player.positionSec() > 3) {
          player.seek(0);
          return;
        }
        const q = queueRef.current;
        const pp = queuePosRef.current - 1;
        if (pp >= 0) void playAt(pp, q);
      },
      stop: () => player.stop(),
    };
    // Automation seam (main.tsx): the media gate drives these directly —
    // Media Session action events cannot be dispatched from page JS.
    if (window.__moodwave) window.__moodwave.media = ctl;
    return registerMediaControls(ctl);
  }, [playAt]);

  const doImport = useCallback(async () => {
    if (update.active) return;
    const files = await pickAudioFiles();
    if (files.length === 0) return;
    // Rescan semantics: files already in the library (same path + size +
    // mtime) are skipped, so re-importing only adds new/changed tracks.
    const seen = new Set(records.map((r) => `${r.path}|${r.sizeBytes}|${r.modifiedEpoch}`));
    setUpdate({ active: true, done: 0, total: files.length, errors: 0, skipped: 0, kind: "scan" });
    cancelImportRef.current = false;
    await importFiles(
      files,
      (p: ImportProgress) =>
        setUpdate({ active: true, done: p.done, total: p.total, errors: p.errors, skipped: p.skipped, kind: "scan" }),
      () => cancelImportRef.current,
      (path, sizeBytes, modifiedEpoch) => seen.has(`${path}|${sizeBytes}|${modifiedEpoch}`),
    );
    setUpdate((u) => ({ ...u, active: false }));
    const recs = await reload();
    if (recs.length > 0 && screen === "empty") {
      setNpAnim("enter");
      setScreen("nowplaying");
      if (npEntry) rebuildQueue(npEntry, selection, recs);
    }
  }, [update.active, reload, screen, npEntry, selection]);

  const doRebuild = useCallback(async () => {
    if (update.active) return;
    const recs = await allRecords();
    if (recs.length === 0) return;
    // Clear every stored analysis/classification and recreate them from the
    // stored audio bytes with the faithful PSP engine.
    setUpdate({ active: true, done: 0, total: recs.length, errors: 0, skipped: 0, kind: "rebuild" });
    cancelImportRef.current = false;
    await rebuildLibrary(
      recs,
      (p) => setUpdate({ active: true, done: p.done, total: p.total, errors: p.errors, skipped: 0, kind: "rebuild" }),
      () => cancelImportRef.current,
    );
    setUpdate((u) => ({ ...u, active: false }));
    const fresh = await reload();
    if (fresh.length > 0 && npEntry) rebuildQueue(npEntry, selection, fresh);
  }, [update.active, reload, npEntry, selection]);

  // Options → Metadata Lookup (ADR-019): fill missing tags/artwork/label
  // from MusicBrainz + Cover Art Archive. User-initiated only; the app
  // never reaches for the network by itself.
  const doEnrich = useCallback(async () => {
    if (update.active) return;
    const recs = await allRecords();
    if (recs.length === 0) return;
    setUpdate({ active: true, done: 0, total: recs.length, errors: 0, skipped: 0, kind: "metadata" });
    cancelImportRef.current = false;
    await enrichMissing(
      recs,
      (p) => setUpdate({ active: true, done: p.done, total: p.total, errors: p.errors, skipped: p.skipped, kind: "metadata" }),
      () => cancelImportRef.current,
    );
    setUpdate((u) => ({ ...u, active: false }));
    await reload();
  }, [update.active, reload]);

  const doWipe = useCallback(async () => {
    if (update.active) return;
    player.stop();
    await clearLibrary();
    setQueue([]);
    setQueuePos(0);
    setPending(null);
    await reload();
    goScreen("empty");
  }, [update.active, reload, goScreen]);

  const enterChannel = useCallback((idx: number) => {
    const cell = grid[Math.min(idx, grid.length - 1)];
    if (!cell) return;
    const q = rebuildQueue(cell.entry, selection + 1, records);
    setEntryIndex(idx);
    setNpEntry(cell.entry);
    setNpAnim("none"); // un-dim via transition, not the boot fadeUp
    setSelection((s) => s + 1);
    setPending(null);
    goScreen("nowplaying");
    if (q.length > 0) void playAt(0, q);
  }, [grid, records, selection, playAt, goScreen]);

  // ---- shared action dispatcher (UI_SPEC §9) ----
  // Keyboard bindings, caption buttons and touch gestures all resolve to the
  // same actions, so platform inputs cannot drift apart (interaction-model.md).
  function runAction(id: ActionId) {
    if (menuOpenRef.current) {
      if (id === "back") setMenuOpen(false);
      return;
    }
    if (update.active && update.kind !== "metadata" && id === "back") {
      cancelImportRef.current = true; // ✕ Cancel (UI_SPEC §4)
      return;
    }
    switch (id) {
      case "back":
        if (screen === "carousel") {
          setNpAnim("none");
          goScreen("nowplaying");
        } else if (pending !== null) setPending(null); // cancel candidate
        else if (screen === "nowplaying" || screen === "boot") goScreen("carousel"); // toggle channels
        break;
      case "select":
        if (screen === "carousel") {
          if (entryTracks(entry, records).length > 0) enterChannel(entryIndex);
        } else if (pending !== null) confirmPending();
        break;
      case "play":
        if (screen === "empty") void doImport();
        else if (pending !== null) confirmPending(); // START confirms candidate
        else if (current) {
          // START: play/pause toggle. From stopped, (re)load the current
          // track's bytes and play it (player.toggle alone can't start).
          if (player.state === "playing") player.pause();
          else if (player.state === "paused") player.resume();
          else void playAt(queuePos, queue);
        }
        break;
      case "prev":
        prev();
        break;
      case "next":
        next();
        break;
      case "colLeft":
        if (screen === "carousel") moveCol(-1);
        break;
      case "colRight":
        if (screen === "carousel") moveCol(1);
        break;
      case "rowUp":
        if (screen === "carousel") moveRow(1);
        break;
      case "rowDown":
        if (screen === "carousel") moveRow(0);
        break;
      case "add":
        void doImport();
        break;
      case "menu":
        setMenuOpen(true);
        break;
      case "favourite":
        if (current) void toggleFavourite(current, !current.favourite);
        break;
      case "change":
        if (screen === "carousel") {
          setNpAnim("none");
          goScreen("nowplaying");
        } else if (screen === "nowplaying" || screen === "boot") goScreen("carousel");
        break;
    }
  }

  // ---- PSP button map (interaction-model.md) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ✕ shortcuts (menu close / import cancel) have no ActionId of their
      // own beyond "back"; keep the raw-key guards for x/X.
      if (menuOpenRef.current && (e.key === "x" || e.key === "X")) {
        setMenuOpen(false);
        return;
      }
      if (update.active && update.kind !== "metadata" && (e.key === "x" || e.key === "X")) {
        cancelImportRef.current = true; // ✕ Cancel (UI_SPEC §4)
        return;
      }
      switch (e.key) {
        case "ArrowLeft":
          if (screen === "carousel") runAction("colLeft");
          else if (screen === "nowplaying") runAction("prev");
          break;
        case "ArrowRight":
          if (screen === "carousel") runAction("colRight");
          else if (screen === "nowplaying") runAction("next");
          break;
        case "ArrowUp":
          runAction("rowUp");
          break;
        case "ArrowDown":
          runAction("rowDown");
          break;
        case ",":
          runAction("prev");
          break;
        case ".":
          runAction("next");
          break;
        case "Enter":
          runAction("select");
          break;
        case "Escape":
          runAction("back");
          break;
        case " ":
          e.preventDefault();
          runAction("play");
          break;
        case "c":
        case "C":
          runAction("add");
          break;
        case "o":
        case "O":
          runAction("menu");
          break;
        case "f":
        case "F":
          // f favours, shift+F unfavours (keyboard-only nuance; the touch
          // caption button toggles).
          if (!menuOpenRef.current && current) void toggleFavourite(current, !e.shiftKey);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, entryIndex, entry, records, current, queue, queuePos, pending, update.active, doImport, enterChannel]);

  // ---- touch gestures (UI_SPEC §9) ----
  // Tap = ◯/START, horizontal swipe = D-pad ←/→ (L/R staging on now-playing),
  // vertical swipe = D-pad ↑/↓ (SELECT on now-playing). Same dispatcher as the
  // keyboard, so behaviour is identical across platforms.
  useTouchGestures((g) => {
    if (menuOpenRef.current) return; // menu items are buttons themselves
    if (g.type === "swipe") {
      if (screen === "carousel") {
        // Flick semantics, like now-playing: swipe left moves the selection
        // right (the grid slides left), matching the PSP L/R mapping.
        if (g.dir === "left") runAction("colRight");
        else if (g.dir === "right") runAction("colLeft");
        else if (g.dir === "up") runAction("rowUp");
        else runAction("rowDown");
      } else if (screen === "nowplaying") {
        if (g.dir === "left") runAction("next");
        else if (g.dir === "right") runAction("prev");
        else runAction("change");
      }
      return;
    }
    // tap
    if (screen === "empty") {
      runAction("play"); // ◯ Import Music…
      return;
    }
    if (screen === "carousel") {
      const tile = document.elementFromPoint(g.x, g.y)?.closest("[data-entry]");
      const name = tile?.getAttribute("data-entry");
      if (name) {
        const idx = grid.findIndex((c) => c.entry === name);
        // Empty channels stay dimmed and unselectable (R-2 hint).
        if (idx >= 0 && entryTracks(grid[idx]!.entry, records).length > 0) {
          if (idx === entryIndex) runAction("select"); // tap the selected card = ◯
          else setEntryIndex(idx);
        }
        return;
      }
      runAction("select"); // tap elsewhere = ◯
      return;
    }
    runAction("play"); // now-playing tap = START
  });

  // ---- mouse wheel (UI_SPEC §9) ----
  // The wheel steps the same actions as the D-pad: on the grid it rotates
  // the globe one column (right/down = next column, matching the touch
  // flick direction); on now-playing it stages the next/prev candidate, so
  // the two-step L/R animation plays for mouse users too.
  useWheelSteps((dir) => {
    if (menuOpenRef.current) return; // the menu owns the screen while open
    if (screen === "carousel") {
      if (dir === "right" || dir === "down") runAction("colRight");
      else runAction("colLeft");
    } else if (screen === "nowplaying" || screen === "boot") {
      if (dir === "right" || dir === "down") runAction("next");
      else runAction("prev");
    }
  });

  // ---- mouse drag (UI_SPEC §9) ----
  // Press-hold-drag scrubs the channel globe or the now-playing stack
  // fractionally under the pointer; release always settles centered on the
  // nearest element: at half a step or more it commits through the shared
  // dispatcher (same step animation as wheel/keyboard), below it springs
  // back. Progress is clamped so the view can never drag past the ends.
  const [dragFrac, setDragFrac] = useState(0);
  const [dragging, setDragging] = useState(false);
  useMouseDrag({
    enabled: () =>
      !menuOpenRef.current &&
      (screen === "carousel" || ((screen === "nowplaying" || screen === "boot") && queue.length > 0)),
    pitch: () => {
      if (screen === "carousel") {
        const t = tokens.layout.carousel;
        return (t.card.w + t.colGap) * window.innerWidth; // one column step
      }
      const s = slotChain(window.innerWidth / window.innerHeight);
      return (s[1]!.centerX - s[0]!.centerX) * window.innerHeight; // one slot step
    },
    bounds: () => {
      if (screen === "carousel") {
        const cur = grid[Math.min(entryIndex, grid.length - 1)];
        if (!cur) return { min: 0, max: 0 };
        const has = (d: number) => grid.some((c) => c.col === cur.col + d);
        return { min: has(-1) ? -1 : 0, max: has(1) ? 1 : 0 };
      }
      const base = pending ?? queuePos;
      return { min: base - 1 >= 0 ? -1 : 0, max: base + 1 < queue.length ? 1 : 0 };
    },
    onProgress: (f) => {
      setDragging(true);
      setDragFrac(f);
    },
    onRelease: (f) => {
      setDragging(false);
      setDragFrac(0); // snap: transitions are back on, so the remainder animates
      if (Math.abs(f) < 0.5) return; // under half a step: spring back to current
      if (screen === "carousel") runAction(f > 0 ? "colRight" : "colLeft");
      else runAction(f > 0 ? "next" : "prev");
    },
  });

  // ---- mouse clicks (UI_SPEC §9) ----
  // Grid tile: same semantics as a touch tap — clicking an unselected tile
  // moves the selection (the globe rotates), clicking the selected tile
  // enters the channel (◯). Empty channels stay dimmed and unclickable.
  function onTileClick(idx: number) {
    if (menuOpenRef.current || screen !== "carousel") return;
    const cell = grid[idx];
    if (!cell || entryTracks(cell.entry, records).length === 0) return;
    if (idx === entryIndex) runAction("select");
    else setEntryIndex(idx);
  }

  // Now-playing card: clicking a side card stages it as the candidate (the
  // L/R pending animation); clicking the big card confirms the candidate or
  // toggles play/pause (START). Ignored while the grid is open: dimmed
  // cards sit behind the tiles and must not swallow grid clicks.
  function onNpCardClick(idx: number) {
    if (menuOpenRef.current) return;
    if (screen !== "nowplaying" && screen !== "boot") return;
    if (idx === (pending ?? queuePos)) runAction("play");
    else setPending(idx);
  }

  async function toggleFavourite(rec: LibraryRecord, fav: boolean) {
    await updateRecord({ ...rec, favourite: fav });
    await reload();
  }

  function next() {
    if (queue.length === 0) return;
    const base = pending ?? queuePos;
    const np = base + 1;
    if (np >= queue.length) return; // last track: stop
    setPending(np);
  }
  function prev() {
    if (queue.length === 0) return;
    const base = pending ?? queuePos;
    const pp = base - 1;
    if (pp < 0) return; // first track: stop
    setPending(pp);
  }
  function confirmPending() {
    if (pending === null) return;
    const p = pending;
    setPending(null);
    void playAt(p, queue); // scales up to full size and starts playing
  }

  // Backdrop identity: only ever the channel backing the queue. Browsing
  // the grid does NOT change the backdrop; it crossfades when (and only
  // when) the selected channel is entered (UI_SPEC §1).
  const sceneEntry: CarouselEntry = npEntry ?? todForHour(hour);
  const hues = useMemo(() => entryHues(sceneEntry), [sceneEntry]);
  const showCarousel = screen === "carousel" || (transitioning && prevScreen === "carousel");
  // Now-playing elements stay mounted (dimmed) while the grid is open:
  // the transition is a scale-down + dim of the elements only, and they
  // remain visible behind the grid; ✕/Esc reverses it (UI_SPEC §1/§2).
  const showNow = screen === "nowplaying" || screen === "boot" || screen === "carousel";
  const carPhase = screen === "carousel" ? "enter" : "exit";
  const npPhase: "enter" | "dim" | undefined =
    screen === "carousel" ? "dim" : npAnim === "enter" ? "enter" : undefined;
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const cell of grid) out[cell.entry] = entryTracks(cell.entry, records).length;
    return out;
  }, [grid, records]);

  const platform = useMemo(detectPlatform, []);
  const captionSegs = menuOpen
    ? []
    : captionsFor(screen, { playing, pending: pending !== null }, platform);

  return (
    <div className="app" data-scene-key={sceneEntry}>
      <Scene sceneKey={sceneEntry} hues={hues} />
      <RotateHint />

      {showCarousel && <div className={`grid-scrim ${screen === "carousel" ? "on" : ""}`} />}
      {showCarousel && <Carousel grid={grid} selected={entryIndex} counts={counts} phase={carPhase} onSelect={onTileClick} dragFrac={screen === "carousel" ? dragFrac : 0} dragging={dragging && screen === "carousel"} />}
      {showNow && <NowPlaying queue={queue} pos={pending ?? queuePos} pending={pending !== null} entry={sceneEntry} playing={playing} phase={npPhase} onCardClick={onNpCardClick} dragFrac={screen === "carousel" ? 0 : dragFrac} dragging={dragging && screen !== "carousel"} />}

      {screen === "empty" && (
        <div className="empty-card">
          <div className="empty-logo">Moodwave</div>
          <div className="empty-sub">inspired by Sony's SensMe channels</div>
          <button className="empty-btn" onClick={() => void doImport()}>Import Music…</button>
          <div className="empty-hint">offline · local files only · nothing leaves your device</div>
        </div>
      )}

      {/* furniture (R-2) */}
      {settings.showClock && screen !== "empty" && <div className="clock">{clock}</div>}
      {update.active && screen === "empty" && update.kind === "scan" ? (
        // First-run progress card (UI_SPEC §4, R-6 7509): dim scene,
        // centered logo + progress bar + ✕ Cancel. Only the first-run
        // scan gets the modal; every later operation is a discreet
        // corner indicator.
        <>
          <div className="update-scrim" />
          <div className="update-card">
            <div className="update-card-logo">Moodwave</div>
            <div className="update-card-label">
              Updating channels… {update.done}/{update.total}
              {update.skipped > 0 ? ` (${update.skipped} already in library)` : ""}
            </div>
            <div className="update-bar">
              <div
                className="update-bar-fill"
                style={{ width: `${(update.done / Math.max(1, update.total)) * 100}%` }}
              />
            </div>
            {update.errors > 0 && (
              <div className="update-card-errors">({update.errors} failed)</div>
            )}
            <div className="update-card-cancel">✕ Cancel</div>
          </div>
        </>
      ) : update.active ? (
        // Subsequent updates: R-2 top-left indicator + status line.
        <>
          <div className="update-icon">◌</div>
          <div className="status">
            {update.kind === "metadata"
              ? `Updating track metadata… ${update.done}/${update.total}`
              : update.kind === "rebuild"
                ? `Rebuilding channels… ${update.done}/${update.total}`
                : `Updating channels… ${update.done}/${update.total}`}
            {update.skipped > 0 ? ` (${update.skipped} already in library)` : ""}
            {update.errors > 0 ? ` (${update.errors} failed)` : ""}
          </div>
        </>
      ) : null}
      {settings.showCaptions && captionSegs.length > 0 && (
        <div className="captions">
          {captionSegs.map((c) =>
            // Chips are real controls on every platform (UI_SPEC §9): touch
            // taps them, mouse clicks them, and the keyboard bindings stay
            // identical — all three resolve to the same dispatcher.
            <button className="cap cap-btn" key={`${c.key}-${c.desc}`} onClick={() => runAction(c.action)}>
              <span className="cap-key">{c.key}</span>
              <span className="cap-desc">{c.desc}</span>
            </button>,
          )}
        </div>
      )}
      {menuOpen && (
        <Options
          settings={settings}
          onSettings={setSettings}
          onClearFavourites={() => void clearFavourites()}
          onClearBlocked={() => void clearBlocked()}
          onRebuild={() => {
            setMenuOpen(false);
            void doRebuild();
          }}
          onEnrich={() => {
            setMenuOpen(false);
            void doEnrich();
          }}
          onWipe={() => {
            setMenuOpen(false);
            void doWipe();
          }}
          onImport={() => {
            setMenuOpen(false);
            void doImport();
          }}
          meta={meta}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );

  async function clearFavourites() {
    for (const r of records.filter((x) => x.favourite)) await updateRecord({ ...r, favourite: false });
    await reload();
  }
  async function clearBlocked() {
    for (const r of records.filter((x) => x.blocked)) await updateRecord({ ...r, blocked: false });
    await reload();
  }
}
