// App state machine + PSP input mapping (docs/UI_REFERENCES/interaction-model.md).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../../contracts/design-tokens/tokens";
import { engine } from "./engine/engine";
import { allRecords, clearLibrary, getAudioBytes, updateRecord } from "./engine/library";
import { importFiles, pickAudioFiles, rebuildLibrary, type ImportProgress } from "./engine/importer";
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
import { CAROUSEL_ORDER, entryHues, entryTracks, shuffledQueue } from "./ui/channels";
import { captionsFor, detectPlatform, type ActionId } from "./ui/controls";
import { NowPlaying } from "./ui/NowPlaying";
import { Options, type Settings } from "./ui/Options";
import { RotateHint } from "./ui/RotateHint";
import { Scene } from "./ui/Scene";
import { useTouchGestures } from "./ui/touch";

type Screen = "boot" | "empty" | "carousel" | "nowplaying";

interface UpdateState {
  active: boolean;
  done: number;
  total: number;
  errors: number;
  skipped: number;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("boot");
  const [meta, setMeta] = useState<ContractMeta | null>(null);
  const [records, setRecords] = useState<LibraryRecord[]>([]);
  const [entryIndex, setEntryIndex] = useState(0);
  const [selection, setSelection] = useState(0);
  const [queue, setQueue] = useState<LibraryRecord[]>([]);
  const [queuePos, setQueuePos] = useState(0);
  // Two-step track selection (now-playing): L/R stages a candidate at a
  // smaller scale in the big slot; START/◯ confirms (scales up + plays).
  const [pending, setPending] = useState<number | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ active: false, done: 0, total: 0, errors: 0, skipped: 0 });
  const [settings, setSettings] = useState<Settings>({ showClock: true, showCaptions: true });
  const [menuOpen, setMenuOpen] = useState(false);
  const [clock, setClock] = useState("");
  const [playing, setPlaying] = useState(false);
  const [prevScreen, setPrevScreen] = useState<Screen>("boot");
  const [transitioning, setTransitioning] = useState(false);
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;
  // First-run progress card cancel (UI_SPEC §4: ✕ Cancel).
  const cancelImportRef = useRef(false);
  const queuePosRef = useRef(0);
  queuePosRef.current = queuePos;
  const queueRef = useRef<LibraryRecord[]>([]);
  queueRef.current = queue;

  const entry = CAROUSEL_ORDER[entryIndex]!;

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
      // Land on the first carousel entry that actually has tracks (the PSP
      // opens on a populated channel; index 0 may be empty for a given library).
      let idx = CAROUSEL_ORDER.findIndex((e) => entryTracks(e, recs).length > 0);
      if (idx < 0) idx = 0;
      setEntryIndex(idx);
      setScreen("nowplaying");
      rebuildQueue(idx, 0, recs);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clock furniture (top-right, R-2).
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(`${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`);
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

  function rebuildQueue(idx: number, sel: number, recs: LibraryRecord[]): LibraryRecord[] {
    const q = shuffledQueue(CAROUSEL_ORDER[idx]!, sel, recs);
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
    if (window.__sensme) window.__sensme.media = ctl;
    return registerMediaControls(ctl);
  }, [playAt]);

  const doImport = useCallback(async () => {
    if (update.active) return;
    const files = await pickAudioFiles();
    if (files.length === 0) return;
    // Rescan semantics: files already in the library (same path + size +
    // mtime) are skipped, so re-importing only adds new/changed tracks.
    const seen = new Set(records.map((r) => `${r.path}|${r.sizeBytes}|${r.modifiedEpoch}`));
    setUpdate({ active: true, done: 0, total: files.length, errors: 0, skipped: 0 });
    cancelImportRef.current = false;
    await importFiles(
      files,
      (p: ImportProgress) =>
        setUpdate({ active: true, done: p.done, total: p.total, errors: p.errors, skipped: p.skipped }),
      () => cancelImportRef.current,
      (path, sizeBytes, modifiedEpoch) => seen.has(`${path}|${sizeBytes}|${modifiedEpoch}`),
    );
    setUpdate((u) => ({ ...u, active: false }));
    const recs = await reload();
    if (recs.length > 0 && screen === "empty") {
      setScreen("nowplaying");
      rebuildQueue(entryIndex, selection, recs);
    }
  }, [update.active, reload, screen, entryIndex, selection]);

  const doRebuild = useCallback(async () => {
    if (update.active) return;
    const recs = await allRecords();
    if (recs.length === 0) return;
    // Clear every stored analysis/classification and recreate them from the
    // stored audio bytes with the faithful PSP engine.
    setUpdate({ active: true, done: 0, total: recs.length, errors: 0, skipped: 0 });
    cancelImportRef.current = false;
    await rebuildLibrary(
      recs,
      (p) => setUpdate({ active: true, done: p.done, total: p.total, errors: p.errors, skipped: 0 }),
      () => cancelImportRef.current,
    );
    setUpdate((u) => ({ ...u, active: false }));
    const fresh = await reload();
    if (fresh.length > 0) rebuildQueue(entryIndex, selection, fresh);
  }, [update.active, reload, entryIndex, selection]);

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
    const q = rebuildQueue(idx, selection + 1, records);
    setEntryIndex(idx);
    setSelection((s) => s + 1);
    setPending(null);
    goScreen("nowplaying");
    if (q.length > 0) void playAt(0, q);
  }, [records, selection, playAt, goScreen]);

  // ---- shared action dispatcher (UI_SPEC §9) ----
  // Keyboard bindings, caption buttons and touch gestures all resolve to the
  // same actions, so platform inputs cannot drift apart (interaction-model.md).
  function runAction(id: ActionId) {
    if (menuOpenRef.current) {
      if (id === "back") setMenuOpen(false);
      return;
    }
    if (update.active && id === "back") {
      cancelImportRef.current = true; // ✕ Cancel (UI_SPEC §4)
      return;
    }
    switch (id) {
      case "back":
        if (screen === "carousel") goScreen("nowplaying");
        else if (pending !== null) setPending(null); // cancel candidate
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
        if (screen === "carousel") setEntryIndex((i) => Math.max(0, i - 2)); // one column left
        break;
      case "colRight":
        if (screen === "carousel") setEntryIndex((i) => Math.min(CAROUSEL_ORDER.length - 1, i + 2));
        break;
      case "rowUp":
        if (screen === "carousel")
          setEntryIndex((i) => (i % 2 === 0 && i + 1 < CAROUSEL_ORDER.length ? i + 1 : i));
        break;
      case "rowDown":
        if (screen === "carousel") setEntryIndex((i) => (i % 2 === 1 ? i - 1 : i));
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
        if (screen === "carousel") goScreen("nowplaying");
        else if (screen === "nowplaying" || screen === "boot") goScreen("carousel");
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
      if (update.active && (e.key === "x" || e.key === "X")) {
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
        if (g.dir === "left") runAction("colLeft");
        else if (g.dir === "right") runAction("colRight");
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
        const idx = CAROUSEL_ORDER.indexOf(name as (typeof CAROUSEL_ORDER)[number]);
        // Empty channels stay dimmed and unselectable (R-2 hint).
        if (idx >= 0 && entryTracks(CAROUSEL_ORDER[idx]!, records).length > 0) {
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

  const hues = useMemo(() => entryHues(entry), [entry]);
  const showCarousel = screen === "carousel" || (transitioning && prevScreen === "carousel");
  const showNow = screen === "nowplaying" || screen === "boot" || (transitioning && prevScreen === "nowplaying");
  const carPhase = screen === "carousel" ? "enter" : "exit";
  const npPhase = screen === "nowplaying" || screen === "boot" ? "enter" : "exit";
  const counts = useMemo(() => {
    const c = {} as Record<string, number>;
    for (const e of CAROUSEL_ORDER) c[e] = entryTracks(e, records).length;
    return c as Record<(typeof CAROUSEL_ORDER)[number], number>;
  }, [records]);

  const platform = useMemo(detectPlatform, []);
  const captionSegs = menuOpen
    ? []
    : captionsFor(screen, { playing, pending: pending !== null }, platform);

  return (
    <div className="app">
      <Scene sceneKey={entry} hues={hues} />
      <RotateHint />

      {showCarousel && <Carousel selected={entryIndex} counts={counts} phase={carPhase} />}
      {showNow && <NowPlaying queue={queue} pos={pending ?? queuePos} pending={pending !== null} entry={entry} playing={playing} phase={npPhase} />}

      {screen === "empty" && (
        <div className="empty-card">
          <div className="empty-logo">SensMe</div>
          <div className="empty-sub">inspired by Sony's SensMe channels</div>
          <button className="empty-btn" onClick={() => void doImport()}>Import Music…</button>
          <div className="empty-hint">offline · local files only · nothing leaves your device</div>
        </div>
      )}

      {/* furniture (R-2) */}
      {settings.showClock && screen !== "empty" && <div className="clock">{clock}</div>}
      {update.active && screen === "empty" ? (
        // First-run progress card (UI_SPEC §4, R-6 7509): dim scene,
        // centered logo + progress bar + ✕ Cancel.
        <>
          <div className="update-scrim" />
          <div className="update-card">
            <div className="update-card-logo">SensMe</div>
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
            Updating channels… {update.done}/{update.total}
            {update.skipped > 0 ? ` (${update.skipped} already in library)` : ""}
            {update.errors > 0 ? ` (${update.errors} failed)` : ""}
          </div>
        </>
      ) : null}
      {settings.showCaptions && captionSegs.length > 0 && (
        <div className="captions">
          {captionSegs.map((c) =>
            // Touch platforms: chips are real controls (UI_SPEC §9); desktop
            // keeps them as static help text.
            platform === "touch" ? (
              <button className="cap cap-btn" key={`${c.key}-${c.desc}`} onClick={() => runAction(c.action)}>
                <span className="cap-key">{c.key}</span>
                <span className="cap-desc">{c.desc}</span>
              </button>
            ) : (
              <span className="cap" key={`${c.key}-${c.desc}`}>
                <span className="cap-key">{c.key}</span>
                <span className="cap-desc">{c.desc}</span>
              </span>
            ),
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
