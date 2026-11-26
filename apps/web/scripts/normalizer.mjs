// Dynamic Normalizer gate (ADR-018): per-track gain from the Rust core is
// applied at playback, the Sound Settings toggle switches it, and the
// setting persists across reloads. Run against `pnpm preview`.
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
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__sensme?.engine.contract()?.algorithmVersion, null, { timeout: 20000 });

// Fresh library: one tone track.
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("sensme", 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  for (const s of ["tracks", "audio"]) await new Promise((res, rej) => { const t = db.transaction(s, "readwrite"); t.objectStore(s).clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
});
await page.evaluate(async () => {
  const blob = await (await fetch("/tone.mp3")).blob();
  await window.__sensme.importFiles([{ file: new File([blob], "tone.mp3", { type: "audio/mpeg" }), path: "tone.mp3" }], () => {});
});
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => (document.querySelector(".np-title")?.textContent ?? "").length > 0, null, { timeout: 20000 });

// 1. The record carries loudness + a sane gain from the Rust core.
const rec = await page.evaluate(async () => (await window.__sensme.allRecords())[0]);
if (!(rec.loudness && rec.loudness.peak > 0 && rec.loudness.rms > 0)) throw new Error(`loudness missing/zero: ${JSON.stringify(rec.loudness)}`);
if (!(rec.normalizerGain > 0)) throw new Error(`bad gain: ${rec.normalizerGain}`);
ok(`loudness peak=${rec.loudness.peak.toFixed(3)} rms=${rec.loudness.rms.toFixed(3)} gain=${rec.normalizerGain.toFixed(3)}`);

// 2. Playing with the default (ON) applies the record's gain.
await page.keyboard.press(" ");
await page.waitForFunction(() => window.__sensme.player.state === "playing", null, { timeout: 10000 });
const gainOn = await page.evaluate(() => window.__sensme.player.gainValue());
if (Math.abs(gainOn - rec.normalizerGain) > 1e-6) throw new Error(`gain not applied: ${gainOn} vs ${rec.normalizerGain}`);
ok("playback gain = record normalizerGain (setting ON)");

// 3. Sound Settings → Dynamic Normalizer → OFF: gain returns to unity live.
await page.keyboard.press("o");
await page.waitForSelector(".menu-item");
await page.locator(".menu-item", { hasText: "Sound Settings" }).click();
await page.locator(".menu-item", { hasText: "Dynamic Normalizer: ON" }).click();
await page.waitForFunction(() => window.__sensme.player.gainValue() === 1, null, { timeout: 5000 });
ok("toggle OFF restores unity gain live");

// 4. Setting persists across reload (the original persists to property.xml).
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => (document.querySelector(".np-title")?.textContent ?? "").length > 0, null, { timeout: 20000 });
await page.keyboard.press(" ");
await page.waitForFunction(() => window.__sensme.player.state === "playing", null, { timeout: 10000 });
const gainAfter = await page.evaluate(() => window.__sensme.player.gainValue());
if (gainAfter !== 1) throw new Error(`setting did not persist: gain ${gainAfter}`);
ok("setting persists across reload (OFF stays OFF)");

await browser.close();
console.log("NORMALIZER GATE OK");
