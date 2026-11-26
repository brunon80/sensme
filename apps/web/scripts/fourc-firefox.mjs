// Phase 4c done-gate check: full analyze→browse→play loop in Firefox.
// Run against the preview server: pnpm preview --port 4173
import { firefox } from "playwright";

const URL = process.env.SENSME_URL ?? "http://127.0.0.1:4173/";

const browser = await firefox.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__sensme?.engine.contract()?.algorithmVersion, null, { timeout: 20000 });

// Fresh library.
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("sensme", 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  for (const s of ["tracks", "audio"]) await new Promise((res, rej) => { const t = db.transaction(s, "readwrite"); t.objectStore(s).clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
});

// Import the two fixtures through the real pipeline (PickedFile shape:
// the display path travels alongside the file).
const imported = await page.evaluate(async () => {
  const files = [];
  for (const name of ["tone.mp3", "tone.flac"]) {
    const blob = await (await fetch("/" + name)).blob();
    files.push({ file: new File([blob], name, { type: blob.type }), path: name });
  }
  await window.__sensme.importFiles(files, () => {});
  return (await window.__sensme.allRecords()).length;
});

// Reload: persistence + boot into now-playing.
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => (document.querySelector(".np-title")?.textContent ?? "").length > 0, null, { timeout: 20000 });
const title = await page.textContent(".np-title");

// Browse: toggle the carousel (Escape) -> select a channel with tracks ->
// playback.
await page.keyboard.press("Escape");
await page.waitForSelector(".carousel-name");
const channel = await page.textContent(".carousel-name");
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.__sensme.player.state === "playing", null, { timeout: 10000 });
const state = await page.evaluate(() => window.__sensme.player.state);

await browser.close();

const ok = imported === 2 && !!title && !!channel && state === "playing" && errors.length === 0;
console.log(JSON.stringify({ imported, title, channel, state, errors, ok }));
process.exit(ok ? 0 : 1);
