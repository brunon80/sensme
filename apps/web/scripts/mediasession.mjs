// OS media-integration gate (ADR-017): the Media Session API must publish
// now-playing metadata and transport controls so Windows/Linux desktop
// environments show them (Chromium owns the OS integration: Windows media
// overlay, Linux MPRIS). Run against the preview server:
//   pnpm build && pnpm preview --port 4173
//   node scripts/mediasession.mjs
import { chromium } from "playwright";

const URL = process.env.MOODWAVE_URL ?? "http://127.0.0.1:4173/";

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__moodwave?.engine.contract()?.algorithmVersion, null, { timeout: 20000 });

// Fresh library.
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("moodwave", 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  for (const s of ["tracks", "audio"]) await new Promise((res, rej) => { const t = db.transaction(s, "readwrite"); t.objectStore(s).clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
});

// Three copies of the same tone under distinct names: identical analysis,
// so all three land in the same channel queue, and distinct display titles
// make track changes observable.
await page.evaluate(async () => {
  const blob = await (await fetch("/tone.mp3")).blob();
  const files = ["tone-a.mp3", "tone-b.mp3", "tone-c.mp3"].map((name) => ({
    file: new File([blob], name, { type: "audio/mpeg" }),
    path: name,
  }));
  await window.__moodwave.importFiles(files, () => {});
});

// Reload: boot into now-playing, then open the channel carousel (Escape =
// PSP toggle) and enter the first populated channel.
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => (document.querySelector(".np-title")?.textContent ?? "").length > 0, null, { timeout: 20000 });
await page.keyboard.press("Escape");
await page.waitForSelector(".carousel-name");
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.__moodwave.player.state === "playing", null, { timeout: 10000 });

const snap = () =>
  page.evaluate(() => ({
    playerState: window.__moodwave.player.state,
    pbState: navigator.mediaSession.playbackState,
    title: navigator.mediaSession.metadata?.title ?? null,
    artwork: (navigator.mediaSession.metadata?.artwork ?? []).length,
    npTitle: document.querySelector(".np-title")?.textContent ?? null,
    duration: window.__moodwave.player.durationSec(),
  }));

// Metadata + playback state published to the OS while playing.
const playing = await snap();
const posState = await page
  .waitForFunction(() => window.__moodwave.mediaSession.lastPositionState(), null, { timeout: 5000 })
  .then((h) => h.jsonValue());

// The OS controls drive the app: pause / play round-trip.
await page.evaluate(() => window.__moodwave.media.pause());
const paused = await snap();
await page.evaluate(() => window.__moodwave.media.play());
await page.waitForFunction(() => window.__moodwave.player.state === "playing", null, { timeout: 5000 });

// Next / previous skip immediately (hardware-key semantics, no staging).
const beforeNext = await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null);
await page.evaluate(() => window.__moodwave.media.next());
await page.waitForFunction(
  (t) => (navigator.mediaSession.metadata?.title ?? null) !== t,
  beforeNext,
  { timeout: 5000 },
);
const afterNext = await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null);
await page.evaluate(() => {
  window.__moodwave.player.seek(0); // at the start, prev means "previous track"
  window.__moodwave.media.prev();
});
await page.waitForFunction(
  (t) => (navigator.mediaSession.metadata?.title ?? null) === t,
  beforeNext,
  { timeout: 5000 },
);
const afterPrev = await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null);

// Browsing the grid must NOT change the backdrop: it crossfades only when
// a channel is entered (UI_SPEC §1).
const sceneBefore = await page.evaluate(() => document.querySelector(".app")?.dataset.sceneKey ?? null);
await page.keyboard.press("Escape");
await page.waitForSelector(".carousel-name");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(500); // any crossfade would have started by now
const sceneBrowse = await page.evaluate(() => document.querySelector(".app")?.dataset.sceneKey ?? null);
await page.keyboard.press("Escape"); // cancel the browse
await page.waitForTimeout(500);
const sceneAfter = await page.evaluate(() => document.querySelector(".app")?.dataset.sceneKey ?? null);

// OS stop clears the session.
await page.evaluate(() => window.__moodwave.media.stop());
const stopped = await snap();

await browser.close();

const ok =
  playing.playerState === "playing" &&
  playing.pbState === "playing" &&
  !!playing.title &&
  playing.title === playing.npTitle &&
  playing.artwork > 0 &&
  playing.duration > 0 &&
  posState !== null &&
  posState.duration > 0 &&
  paused.playerState === "paused" &&
  paused.pbState === "paused" &&
  afterNext !== beforeNext &&
  afterPrev === beforeNext &&
  sceneBrowse === sceneBefore &&
  sceneAfter === sceneBefore &&
  stopped.playerState === "stopped" &&
  stopped.pbState === "none" &&
  errors.length === 0;

console.log(JSON.stringify({ playing, posState, paused, afterNext, afterPrev, stopped, errors, ok }));
process.exit(ok ? 0 : 1);
