// Mouse-control gate (UI_SPEC §9): caption chips are clickable buttons on
// desktop, the wheel steps the now-playing carousel and the channel grid,
// press-hold-drag scrubs both views live and snaps to the nearest element,
// cards/tiles are clickable with the PSP two-step semantics, and the
// Options caption opens the settings menu. Run against `pnpm preview`.
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

// Fresh library: two tone tracks scored for Morning (index 8) and
// Energetic (index 0) so both channels are populated (clickable) and the
// now-playing queue has a next/prev candidate to stage.
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__sensme?.engine.contract()?.algorithmVersion, null, { timeout: 20000 });
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("sensme", 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  for (const s of ["tracks", "audio"]) await new Promise((res, rej) => { const t = db.transaction(s, "readwrite"); t.objectStore(s).clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
  localStorage.setItem("sensme.settings", JSON.stringify({ showClock: true, showCaptions: true, dynamicNormalizer: true, allDayChannels: false }));
});
await page.evaluate(async () => {
  const blob = await (await fetch("/tone.mp3")).blob();
  await window.__sensme.importFiles(
    [
      { file: new File([blob], "tone1.mp3", { type: "audio/mpeg" }), path: "tone1.mp3" },
      { file: new File([blob], "tone2.mp3", { type: "audio/mpeg" }), path: "tone2.mp3" },
    ],
    () => {},
  );
});
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("sensme", 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const recs = await new Promise((res, rej) => { const t = db.transaction("tracks", "readonly"); const r = t.objectStore("tracks").getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const t = db.transaction("tracks", "readwrite");
  for (const rec of recs) {
    rec.classification.channels.scores = rec.classification.channels.scores.map((s, i) => (i === 8 || i === 0 ? 1 : Math.min(s, 0.4)));
    t.objectStore("tracks").put(rec);
  }
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
});

// Fixed clock at 07:30: boot lands on Morning (the time-of-day channel).
await page.clock.install({ time: new Date("2026-06-01T07:30:00") });
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => (document.querySelector(".np-title")?.textContent ?? "").length > 0, null, { timeout: 20000 });
await page.waitForFunction(() => window.__sensme.player.state === "playing", null, { timeout: 10000 });

const captionText = () => page.evaluate(() => document.querySelector(".captions")?.innerText ?? "");
// .carousel-name carries a mirrored reflection span: read only the label.
const carName = () => page.evaluate(() => (document.querySelector(".carousel-name")?.firstChild?.textContent ?? "").trim());

// 1. Desktop caption chips are real buttons (UI_SPEC §9).
const capButtons = await page.evaluate(() => document.querySelectorAll("button.cap-btn").length);
if (capButtons < 7) throw new Error(`desktop caption buttons: ${capButtons}, want >= 7`);
ok("caption chips render as buttons on desktop");

// 2. Wheel down stages the next candidate (pending), wheel up re-stages,
//    and clicking the big card confirms (caption flips Confirm → Pause).
await page.mouse.wheel(0, 120);
await page.waitForFunction(() => (document.querySelector(".captions")?.innerText ?? "").includes("Confirm"), null, { timeout: 5000 });
ok("wheel down stages the next candidate (L/R two-step preserved)");
await page.mouse.wheel(0, -120);
await page.waitForFunction(() => document.querySelector('[data-np-idx="0"].np-track') !== null, null, { timeout: 5000 });
await page.locator('.np-track[data-np-idx="0"]').click();
await page.waitForFunction(() => !(document.querySelector(".captions")?.innerText ?? "").includes("Confirm"), null, { timeout: 5000 });
if (!(await captionText()).includes("Pause")) throw new Error("confirming the candidate did not start playback");
ok("clicking the big card confirms the candidate and plays");

// 3. Clicking a side card stages it directly, clicking it again (now the
//    big card) confirms.
await page.locator('.np-track[data-np-idx="1"]').click();
await page.waitForFunction(() => (document.querySelector(".captions")?.innerText ?? "").includes("Confirm"), null, { timeout: 5000 });
await page.locator('.np-track[data-np-idx="1"]').click();
await page.waitForFunction(() => (document.querySelector(".captions")?.innerText ?? "").includes("Pause"), null, { timeout: 5000 });
ok("side-card click stages, big-card click confirms");

// 3b. Press-hold-drag scrubs the stack and snaps to the nearest track: a
//     full drag stages the prev candidate; a sub-half drag springs back
//     and its trailing click is swallowed (playback keeps running).
const big1 = await page.locator('.np-track[data-np-idx="1"]').boundingBox();
await page.mouse.move(big1.x + big1.width / 2, big1.y + big1.height / 2);
await page.mouse.down();
await page.mouse.move(big1.x + big1.width / 2 + 400, big1.y + big1.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForFunction(() => (document.querySelector(".captions")?.innerText ?? "").includes("Confirm"), null, { timeout: 5000 });
ok("drag right snaps to the prev track (candidate staged)");
await page.locator('.np-track[data-np-idx="0"]').click();
await page.waitForFunction(() => (document.querySelector(".captions")?.innerText ?? "").includes("Pause"), null, { timeout: 5000 });
const big0 = await page.locator('.np-track[data-np-idx="0"]').boundingBox();
await page.mouse.move(big0.x + big0.width / 2, big0.y + big0.height / 2);
await page.mouse.down();
await page.mouse.move(big0.x + big0.width / 2 - 60, big0.y + big0.height / 2, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(450);
const after = await captionText();
if (after.includes("Confirm") || !after.includes("Pause"))
  throw new Error(`sub-half drag committed or its click leaked: ${after}`);
ok("sub-half drag springs back to the nearest track (click swallowed)");

// 4. The Options caption chip opens the settings menu.
await page.locator(".cap-btn", { hasText: "Options" }).click();
await page.waitForSelector(".menu-panel");
await page.keyboard.press("Escape"); // close the menu (✕ path)
await page.waitForFunction(() => !document.querySelector(".menu-panel"), null, { timeout: 5000 });
ok("Options caption chip opens the settings menu");

// 5. The Change Channels chip opens the grid; the wheel rotates the globe.
await page.locator(".cap-btn", { hasText: "Change Channels" }).click();
await page.waitForSelector(".carousel-name");
const name0 = await carName();
if (name0 !== "Morning") throw new Error(`boot channel: ${name0}`);
await page.mouse.wheel(0, 120);
await page.waitForFunction((prev) => (document.querySelector(".carousel-name")?.firstChild?.textContent ?? "").trim() !== prev, name0, { timeout: 5000 });
const name1 = await carName();
if (name1 !== "Energetic") throw new Error(`wheel column step: ${name1}, want Energetic`);
ok("wheel steps the channel grid one column");

// 5b. Press-hold-drag rotates the globe live and snaps to the nearest
//     column; the trailing click must not enter a channel.
await page.mouse.move(640, 300);
await page.mouse.down();
await page.mouse.move(240, 300, { steps: 12 });
await page.mouse.up();
await page.waitForFunction((prev) => (document.querySelector(".carousel-name")?.firstChild?.textContent ?? "").trim() !== prev, name1, { timeout: 5000 });
const name2 = await carName();
if (name2 !== "Mellow") throw new Error(`drag column step: ${name2}, want Mellow`);
if (!(await page.evaluate(() => !!document.querySelector(".carousel")))) throw new Error("drag entered a channel");
ok("drag left snaps to the next column (stays on the grid)");

// 6. Clicking an unselected tile moves the selection (globe rotates);
//    clicking the selected tile enters the channel.
await page.locator('.tile[data-entry="morning"]').click();
await page.waitForFunction(() => (document.querySelector(".carousel-name")?.firstChild?.textContent ?? "").trim() === "Morning", null, { timeout: 5000 });
ok("clicking a tile moves the selection");
await page.locator('.tile[data-entry="morning"]').click();
await page.waitForFunction(() => !document.querySelector(".carousel"), null, { timeout: 5000 });
await page.waitForFunction(() => window.__sensme.player.state === "playing", null, { timeout: 10000 });
ok("clicking the selected tile enters the channel and plays");

// 7. Empty channels stay unclickable: a click on a dimmed tile is a no-op
//    (Mellow has no scored tracks; Shuffle/Newly are utility channels and
//    always populated, so they are not valid "empty" probes).
await page.locator(".cap-btn", { hasText: "Change Channels" }).click();
await page.waitForSelector(".carousel-name");
await page.locator('.tile[data-entry="mellow"]').click({ force: true });
await page.waitForTimeout(300);
if ((await carName()) !== "Morning") throw new Error("empty channel became selectable");
if (!(await page.evaluate(() => !!document.querySelector(".carousel")))) throw new Error("empty-tile click left the grid");
ok("empty channels stay dimmed and unclickable");

await browser.close();
console.log("MOUSE GATE OK");
