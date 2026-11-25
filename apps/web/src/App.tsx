// App state machine + PSP input mapping (docs/UI_REFERENCES/interaction-model.md).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../../contracts/design-tokens/tokens";
import { engine } from "./engine/engine";
import { allRecords, getAudioBytes, updateRecord } from "./engine/library";
import { importFiles, pickAudioFiles, type ImportProgress } from "./engine/importer";
import { player } from "./engine/player";
import type { ContractMeta, LibraryRecord } from "./engine/types";
import { Carousel } from "./ui/Carousel";
import { CAROUSEL_ORDER, entryHues, entryTracks, shuffledQueue } from "./ui/channels";
import { NowPlaying } from "./ui/NowPlaying";
import { Options, type Settings } from "./ui/Options";
import { Scene } from "./ui/Scene";

type Screen = "boot" | "empty" | "carousel" | "nowplaying";

interface UpdateState {
  active: boolean;
  done: number;
  total: number;
  errors: number;
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
  const [update, setUpdate] = useState<UpdateState>({ active: false, done: 0, total: 0, errors: 0 });
  const [settings, setSettings] = useState<Settings>({ showClock: true, showCaptions: true });
  const [menuOpen, setMenuOpen] = useState(false);
  const [clock, setClock] = useState("");
  const [playing, setPlaying] = useState(false);
  const [prevScreen, setPrevScreen] = useState<Screen>("boot");
  const [transitioning, setTransitioning] = useState(false);
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;
  const queuePosRef = useRef(0);
  queuePosRef.current = queuePos;

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

  // Keep the UI in sync with player state (captions, ▶ tag).
  useEffect(() => player.onChange(() => setPlaying(player.state === "playing")), []);

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

  const playAt = useCallback(async (pos: number, q: LibraryRecord[]) => {
    const rec = q[pos];
    if (!rec) return;
    setQueuePos(pos);
    const bytes = await getAudioBytes(rec.id);
    if (bytes) await player.play(bytes, () => void nextIn(q));
  }, []);

  const nextIn = useCallback((q: LibraryRecord[]) => {
    const pos = queuePosRef.current;
    const np = pos + 1;
    if (np < q.length) void playAt(np, q); // end of queue: stop, don't loop
  }, [playAt]);

  const doImport = useCallback(async () => {
    if (update.active) return;
    const files = await pickAudioFiles();
    if (files.length === 0) return;
    setUpdate({ active: true, done: 0, total: files.length, errors: 0 });
    await importFiles(files, (p: ImportProgress) =>
      setUpdate({ active: true, done: p.done, total: p.total, errors: p.errors }));
    setUpdate((u) => ({ ...u, active: false }));
    const recs = await reload();
    if (recs.length > 0 && screen === "empty") {
      setScreen("nowplaying");
      rebuildQueue(entryIndex, selection, recs);
    }
  }, [update.active, reload, screen, entryIndex, selection]);

  const enterChannel = useCallback((idx: number) => {
    const q = rebuildQueue(idx, selection + 1, records);
    setEntryIndex(idx);
    setSelection((s) => s + 1);
    setPending(null);
    goScreen("nowplaying");
    if (q.length > 0) void playAt(0, q);
  }, [records, selection, playAt, goScreen]);

  // ---- PSP button map (interaction-model.md) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (menuOpenRef.current) {
        if (e.key === "Escape" || e.key === "x" || e.key === "X") setMenuOpen(false);
        return;
      }
      switch (e.key) {
        case "ArrowLeft":
          if (screen === "carousel") setEntryIndex((i) => Math.max(0, i - 2)); // one column left
          else if (screen === "nowplaying") void prev();
          break;
        case "ArrowRight":
          if (screen === "carousel") setEntryIndex((i) => Math.min(CAROUSEL_ORDER.length - 1, i + 2));
          else if (screen === "nowplaying") void next();
          break;
        case "ArrowUp":
          if (screen === "carousel")
            setEntryIndex((i) => (i % 2 === 0 && i + 1 < CAROUSEL_ORDER.length ? i + 1 : i));
          break;
        case "ArrowDown":
          if (screen === "carousel") setEntryIndex((i) => (i % 2 === 1 ? i - 1 : i));
          break;
        case ",":
          void prev();
          break;
        case ".":
          void next();
          break;
        case "Enter":
          if (screen === "carousel") {
            if (entryTracks(entry, records).length > 0) enterChannel(entryIndex);
          } else if (pending !== null) confirmPending();
          else goScreen("carousel");
          break;
        case "Escape":
          if (screen === "carousel") goScreen("nowplaying");
          else if (pending !== null) setPending(null); // cancel candidate
          break;
        case " ":
          e.preventDefault();
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
        case "c":
        case "C":
          void doImport();
          break;
        case "o":
        case "O":
          setMenuOpen(true);
          break;
        case "f":
        case "F":
          if (current) void toggleFavourite(current, !e.shiftKey);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, entryIndex, entry, records, current, queue, queuePos, pending, doImport, enterChannel]);

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

  const captionText = menuOpen
    ? ""
    : screen === "carousel"
      ? "✕ Back    ◯ Select"
      : screen === "empty"
        ? "◯ Import Music…    C"
        : pending !== null
          ? "START/◯ Confirm · ✕ Cancel · L ◀ Prev · R Next ▶"
          : playing
            ? "SELECT Change Channels · START Pause · L ◀ Prev · R Next ▶ · ♥ Favourites"
            : "SELECT Change Channels · START Play · L ◀ Prev · R Next ▶ · ♥ Favourites";

  return (
    <div className="app">
      <Scene sceneKey={entry} hues={hues} />

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
      {update.active && (
        <>
          <div className="update-icon">◌</div>
          <div className="status">
            Updating channels… {update.done}/{update.total}
            {update.errors > 0 ? ` (${update.errors} failed)` : ""}
          </div>
        </>
      )}
      {settings.showCaptions && captionText && <div className="captions">{captionText}</div>}

      {menuOpen && (
        <Options
          settings={settings}
          onSettings={setSettings}
          onClearFavourites={() => void clearFavourites()}
          onClearBlocked={() => void clearBlocked()}
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
