// Mobile adaptation gate (UI_SPEC §9): on an emulated touch device the app
// must lock to landscape (rotate overlay in portrait, manifest orientation)
// and drive every PSP action through touch: tap = ◯/START, horizontal
// swipe = L/R staging, vertical swipe = SELECT, caption chips are buttons.
// Run against the preview server:
//   pnpm build && pnpm preview --port 4173
//   node scripts/mobile.mjs
import { chromium, devices } from "playwright";

const URL = process.env.SENSME_URL ?? "http://127.0.0.1:4173/";

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] }); // 412x915 portrait, touch
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const fail = (msg) => {
  console.error(`MOBILE GATE FAIL: ${msg}`);
  process.exitCode = 1;
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

// CDP touch events so pointerType === "touch" (page.mouse would not).
const cdp = await ctx.newCDPSession(page);
async function swipe(x1, y1, x2, y2) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y: y1 }] });
  const steps = 6;
  for (let i = 1; i <= steps; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps }],
    });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__sensme?.engine.contract()?.algorithmVersion, null, { timeout: 20000 });

// 1. Portrait on a touch device: the rotate overlay covers the scene.
if (await page.locator(".rotate-hint").isVisible()) ok("portrait: rotate overlay visible");
else fail("portrait: rotate overlay not visible");

// 2. Installed/PWA landscape lock is declared in the manifest.
const manifest = await page.evaluate(async () => await (await fetch("manifest.webmanifest")).json());
if (manifest.orientation === "landscape") ok("manifest declares orientation=landscape");
else fail(`manifest orientation is ${JSON.stringify(manifest.orientation)}`);

// Fresh library with three same-tone tracks (one channel queue, distinct titles).
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("sensme", 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  for (const s of ["tracks", "audio"]) await new Promise((res, rej) => { const t = db.transaction(s, "readwrite"); t.objectStore(s).clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
});
await page.evaluate(async () => {
  const blob = await (await fetch("/tone.mp3")).blob();
  const files = ["tone-a.mp3", "tone-b.mp3", "tone-c.mp3"].map((name) => ({
    file: new File([blob], name, { type: "audio/mpeg" }),
    path: name,
  }));
  await window.__sensme.importFiles(files, () => {});
});
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => (document.querySelector(".np-title")?.textContent ?? "").length > 0, null, { timeout: 20000 });

// 3. Rotate to landscape: the overlay goes away.
await page.setViewportSize({ width: 915, height: 412 });
await page.waitForFunction(() => {
  const el = document.querySelector(".rotate-hint");
  return !!el && getComputedStyle(el).display === "none";
}, null, { timeout: 5000 });
ok("landscape: rotate overlay hidden");

// 4. Horizontal swipe on now-playing stages the next candidate (L/R).
await swipe(700, 206, 200, 206); // swipe left → next
await page.waitForFunction(() => [...document.querySelectorAll(".cap-desc")].some((d) => d.textContent === "Confirm"), null, { timeout: 5000 });
ok("swipe left stages next candidate");

// 5. Tap on the artwork confirms the candidate (START) and playback starts.
await page.touchscreen.tap(300, 206);
await page.waitForFunction(() => window.__sensme.player.state === "playing", null, { timeout: 10000 });
ok("tap confirms candidate and starts playback");

// 6. Caption chip is a button: tapping START pauses.
const startChip = page.locator(".cap-btn", { hasText: "START" });
if (await startChip.count() === 1) {
  await startChip.tap();
  await page.waitForFunction(() => window.__sensme.player.state === "paused", null, { timeout: 5000 });
  ok("caption chip button pauses playback");
} else fail("no tappable START caption chip on touch");

// 7. Vertical swipe = SELECT: opens the channel carousel.
await swipe(457, 120, 457, 320); // swipe down
await page.waitForSelector(".carousel-name", { timeout: 5000 });
ok("vertical swipe opens channel carousel");

// 8. Horizontal swipe moves a column in the carousel.
const nameBefore = await page.locator(".carousel-name").textContent();
await swipe(700, 206, 200, 206); // swipe left → one column right
await page.waitForFunction(
  (before) => (document.querySelector(".carousel-name")?.textContent ?? "") !== before,
  nameBefore,
  { timeout: 5000 },
);
ok("carousel swipe moves columns");

// 9. Tapping the selected tile enters the channel (◯) and starts playback.
// Swipe back first: the boot selection is the first populated channel, and
// empty channels stay unselectable (R-2 hint).
await swipe(200, 206, 700, 206); // swipe right → back to the populated column
await page.waitForFunction((before) => (document.querySelector(".carousel-name")?.textContent ?? "") === before, nameBefore, { timeout: 5000 });
const box = await page.locator(".tile-sel").boundingBox();
await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForFunction(
  () => !!document.querySelector(".np-title")?.textContent && !document.querySelector(".carousel-name"),
  null,
  { timeout: 10000 },
);
await page.waitForFunction(() => window.__sensme.player.state === "playing", null, { timeout: 10000 });
ok("tile tap enters channel and plays");

if (errors.length) fail(`page errors: ${errors.join("; ")}`);
await browser.close();
console.log(process.exitCode ? "MOBILE GATE FAILED" : "MOBILE GATE OK");
