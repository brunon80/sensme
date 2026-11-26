// Marquee gate (UI_SPEC §2): now-playing text auto-scrolls when it does not
// fit and stays static when it does. Run against `pnpm preview`.
import { chromium } from "playwright";
const URL = process.env.SENSME_URL ?? "http://127.0.0.1:4173/";

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

const META = {
  title: "This Extremely Long Track Title Exists Solely To Prove That The Marquee Scrolls Forever And Ever Amen",
  artist: "An Artist Name That Is Also Quite Long Indeed So That Line Overflows Too",
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => {
  console.error("page error:", e);
  process.exit(1);
});
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__sensme?.engine.contract()?.algorithmVersion, null, { timeout: 20000 });

// Fresh library: tone.mp3 with a long ID3v2.3 tag prepended.
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("sensme", 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  for (const s of ["tracks", "audio"]) await new Promise((res, rej) => { const t = db.transaction(s, "readwrite"); t.objectStore(s).clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
});
await page.evaluate(async (meta) => {
  const frame = (id, text) => {
    const body = new TextEncoder().encode(text);
    const h = new Uint8Array(10 + 1 + body.length);
    for (let i = 0; i < 4; i++) h[i] = id.charCodeAt(i);
    const len = 1 + body.length; // encoding byte + text
    h[4] = (len >> 21) & 0x7f; h[5] = (len >> 14) & 0x7f; h[6] = (len >> 7) & 0x7f; h[7] = len & 0x7f;
    h[10] = 3; // payload starts after the 10-byte header: encoding UTF-8
    h.set(body, 11);
    return h;
  };
  const frames = [frame("TIT2", meta.title), frame("TPE1", meta.artist)];
  const bodyLen = frames.reduce((a, f) => a + f.length, 0);
  const tag = new Uint8Array(10 + bodyLen);
  tag.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00], 0); // "ID3" v2.3, no flags
  tag[6] = (bodyLen >> 21) & 0x7f; tag[7] = (bodyLen >> 14) & 0x7f; tag[8] = (bodyLen >> 7) & 0x7f; tag[9] = bodyLen & 0x7f;
  let off = 10;
  for (const f of frames) { tag.set(f, off); off += f.length; }
  const mp3 = new Uint8Array(await (await fetch("/tone.mp3")).arrayBuffer());
  const file = new File([tag, mp3], "long-title.mp3", { type: "audio/mpeg" });
  await window.__sensme.importFiles([{ file, path: "long-title.mp3" }], () => {});
}, META);
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => (document.querySelector(".np-title")?.textContent ?? "").length > 0, null, { timeout: 20000 });

// 1. The long title overflows and its inner span runs the marquee.
const st = await page.evaluate(() => {
  const line = document.querySelector(".np-title");
  const inner = line.querySelector(".marquee-inner");
  const anims = inner.getAnimations();
  return {
    title: line.textContent,
    run: inner.classList.contains("marquee-run"),
    overflow: inner.offsetWidth - line.clientWidth,
    scroll: inner.style.getPropertyValue("--marquee-px"),
    anim: anims.length > 0 && anims[0].playState === "running",
    reflected: !!document.querySelector(".np-text-reflect .marquee-inner.marquee-run"),
  };
});
if (!st.title.startsWith("This Extremely Long")) throw new Error(`tag not read: ${JSON.stringify(st)}`);
if (st.overflow <= 0) throw new Error(`title should overflow: ${JSON.stringify(st)}`);
if (!st.run || !st.anim) throw new Error(`marquee not running: ${JSON.stringify(st)}`);
if (!st.scroll || parseFloat(st.scroll) <= 0) throw new Error(`bad scroll distance: ${JSON.stringify(st)}`);
if (!st.reflected) throw new Error("reflection does not scroll");
ok(`long title scrolls (overflow ${st.overflow}px, distance ${st.scroll}, reflection synced)`);

// 2. The transform actually moves over time.
const t0 = await page.evaluate(() => getComputedStyle(document.querySelector(".np-title .marquee-inner")).transform);
await page.waitForTimeout(2500);
const t1 = await page.evaluate(() => getComputedStyle(document.querySelector(".np-title .marquee-inner")).transform);
if (t0 === t1) throw new Error(`transform did not move: ${t0}`);
ok("text position advances over time");

// 3. A short title stays static (no marquee class, ellipsis path intact).
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("sensme", 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const keys = await new Promise((res, rej) => { const t = db.transaction("tracks", "readonly"); const r = t.objectStore("tracks").getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  if (keys.length === 0) throw new Error("no track in library");
  const rec = await new Promise((res, rej) => { const t = db.transaction("tracks", "readonly"); const r = t.objectStore("tracks").get(keys[0]); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  rec.title = "Short";
  const t = db.transaction("tracks", "readwrite");
  t.objectStore("tracks").put(rec);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
});
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => (document.querySelector(".np-title")?.textContent ?? "").trim() === "Short", null, { timeout: 20000 });
const st2 = await page.evaluate(() => {
  const inner = document.querySelector(".np-title .marquee-inner");
  return { run: inner.classList.contains("marquee-run"), anims: inner.getAnimations().length };
});
if (st2.run || st2.anims !== 0) throw new Error(`short title should be static: ${JSON.stringify(st2)}`);
ok("short title stays static");

await browser.close();
console.log("MARQUEE GATE OK");
