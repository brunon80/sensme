// Channel-grid gate (UI_SPEC §1): two-row layout with the requested order,
// the single time-of-day card following the clock (Morning 05-09, Daytime
// 10-15, Evening 16-18, Night 19-23, Midnight 00-04), and the View
// Settings → All Day Channels toggle restoring all five. Run against
// `pnpm preview`.
import { chromium } from "playwright";
const URL = process.env.SENSME_URL ?? "http://127.0.0.1:4173/";

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => {
  console.error("page error:", e);
  process.exit(1);
});

// Fresh library: one tone track (the grid shows every entry; empty counts
// only dim, never hide).
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__sensme?.engine.contract()?.algorithmVersion, null, { timeout: 20000 });
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("sensme", 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  for (const s of ["tracks", "audio"]) await new Promise((res, rej) => { const t = db.transaction(s, "readwrite"); t.objectStore(s).clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
  localStorage.setItem("sensme.settings", JSON.stringify({ showClock: true, showCaptions: true, dynamicNormalizer: true, allDayChannels: false }));
});
await page.evaluate(async () => {
  const blob = await (await fetch("/tone.mp3")).blob();
  await window.__sensme.importFiles([{ file: new File([blob], "tone.mp3", { type: "audio/mpeg" }), path: "tone.mp3" }], () => {});
});
// Make the tone a Morning-channel track (top score at the morning slot:
// classifier order is energetic..midnight, morning at index 8) so the
// boot-entrypoint check below is deterministic.
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("sensme", 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const rec = await new Promise((res, rej) => { const t = db.transaction("tracks", "readonly"); const r = t.objectStore("tracks").getAll(); r.onsuccess = () => res(r.result[0]); r.onerror = () => rej(r.error); });
  rec.classification.channels.scores = rec.classification.channels.scores.map((s, i) => (i === 8 ? 1 : Math.min(s, 0.4)));
  const t = db.transaction("tracks", "readwrite");
  t.objectStore("tracks").put(rec);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
});

// The app exposes the current grid on the test hook (main.tsx __sensme).
// The DOM renders a ±2-column window around the selection; verify the
// selected tile is on the DOM, then read rows from the hook.
async function readGrid() {
  await page.waitForSelector(".carousel-name");
  const g = await page.evaluate(() => {
    const grid = window.__sensme?.grid ?? [];
    const sel = document.querySelector(".tile-sel");
    return { grid, sel: sel?.dataset.entry };
  });
  if (!g.sel || !g.grid.some((c) => c.entry === g.sel)) throw new Error(`selected tile not on grid: ${g.sel}`);
  const top = g.grid.filter((c) => c.row === 1).sort((a, b) => a.col - b.col).map((c) => c.entry);
  const bottom = g.grid.filter((c) => c.row === 0).sort((a, b) => a.col - b.col).map((c) => c.entry);
  return { top, bottom };
}

// 1. Fixed clock at 07:30 (Morning): exact two-row order.
await page.clock.install({ time: new Date("2026-06-01T07:30:00") });
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => (document.querySelector(".np-title")?.textContent ?? "").length > 0, null, { timeout: 20000 });
await page.keyboard.press("Escape");
let g = await readGrid();
// Boot entrypoint: the current time-of-day channel (Morning @07:30).
const bootSel = await page.evaluate(() => document.querySelector(".tile-sel")?.dataset.entry);
if (bootSel !== "morning") throw new Error(`boot landing channel: ${bootSel}, want morning`);
ok("boot lands on the current time-of-day channel");
// The PSP opens already playing (autoplay policy may block it in a fresh
// context; the preview grants autoplay, same as the other gates).
await page.waitForFunction(() => window.__sensme.player.state === "playing", null, { timeout: 10000 });
ok("boot starts playback");
const TOP1 = ["morning", "energetic", "mellow", "emotional", "dance", "favourites"];
const BOT1 = ["shuffle", "relax", "upbeat", "lounge", "extreme", "newly"];
if (JSON.stringify(g.top) !== JSON.stringify(TOP1)) throw new Error(`top row @07:30: ${JSON.stringify(g.top)}`);
if (JSON.stringify(g.bottom) !== JSON.stringify(BOT1)) throw new Error(`bottom row @07:30: ${JSON.stringify(g.bottom)}`);
ok("grid order: top morning·energetic·mellow·emotional·dance·favourites, bottom shuffle·relax·upbeat·lounge·extreme·newly");

// 2. Only one time-of-day card by default, and it follows the clock.
const TOD = ["morning", "daytime", "evening", "night", "midnight"];
const todShown = (x) => [...x.top, ...x.bottom].filter((e) => TOD.includes(e));
if (JSON.stringify(todShown(g)) !== JSON.stringify(["morning"])) throw new Error(`tod cards @07:30: ${JSON.stringify(todShown(g))}`);
for (const [h, want] of [[1, "midnight"], [5, "morning"], [10, "daytime"], [16, "evening"], [20, "night"]]) {
  await page.clock.setFixedTime(new Date(`2026-06-01T${String(h).padStart(2, "0")}:30:00`));
  await page.clock.runFor(6000); // the 5 s clock tick re-reads the hour
  g = await readGrid();
  if (JSON.stringify(todShown(g)) !== JSON.stringify([want])) throw new Error(`tod card @${h}:30: ${JSON.stringify(todShown(g))}, want ${want}`);
}
ok("one time-of-day card, switching at 00/05/10/16/19");

// 3. View Settings → All Day Channels ON restores all five, chronological.
// Toggle through the real menu (O → View Settings → All Day Channels),
// then reload to prove the setting persists across boots.
await page.keyboard.press("Escape"); // close the carousel first
await page.keyboard.press("o");
await page.waitForSelector(".menu-item");
await page.locator(".menu-item", { hasText: "View Settings" }).click();
await page.locator(".menu-item", { hasText: "All Day Channels: OFF" }).click();
await page.locator(".menu-item", { hasText: "Back" }).click();
await page.locator(".menu-item", { hasText: "About SensMe channels" }).waitFor();
await page.keyboard.press("Escape"); // close the menu
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => (document.querySelector(".np-title")?.textContent ?? "").length > 0, null, { timeout: 20000 });
await page.keyboard.press("Escape");
g = await readGrid();
if (JSON.stringify(todShown(g)) !== JSON.stringify(TOD)) throw new Error(`all-day tod cards: ${JSON.stringify(todShown(g))}`);
if (JSON.stringify(g.bottom) !== JSON.stringify(BOT1)) throw new Error(`bottom row all-day: ${JSON.stringify(g.bottom)}`);
ok("menu View Settings → All Day Channels ON (persisted across reload): all five lead the top row");

// 4. Selection survives a grid change (rollover keeps the same channel
// selected when it is still on the grid).
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(150);
const name1 = await page.textContent(".carousel-name");
await page.clock.setFixedTime(new Date("2026-06-01T11:30:00"));
await page.clock.runFor(6000);
const name2 = await page.textContent(".carousel-name");
if (name1 !== name2) throw new Error(`selection changed across rollover: ${name1} -> ${name2}`);
ok("selection preserved across the time-of-day rollover");

await browser.close();
console.log("GRID GATE OK");
