// Metadata enrichment gate (ADR-019): Metadata Lookup fills missing
// title/artist/album/artwork/label from MusicBrainz + Cover Art Archive
// (mocked with fixtures), never overwrites existing tags, and persists
// across reloads. Run against `pnpm preview`.
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

// Mock the enrichment APIs: deterministic fixtures, no real network.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
let mbSearchCalls = 0;
await page.route("**/musicbrainz.org/ws/2/recording/**", (route) => {
  mbSearchCalls += 1;
  // First hit: transient 523 (their edge is busy) — the client must
  // back off and retry; the second attempt fulfills normally.
  if (mbSearchCalls === 1) {
    route.fulfill({ status: 523, contentType: "text/plain", body: "origin busy" });
    return;
  }
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      recordings: [
        {
          id: "rec-0001",
          title: "Test Song",
          "artist-credit": [{ name: "Test Artist" }],
          "release-group": { id: "rg-0001" },
          releases: [{ id: "rel-0001", title: "Test Album", date: "2001-06-15" }],
        },
      ],
    }),
  });
});
await page.route("**/musicbrainz.org/ws/2/release/**", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: "rel-0001",
      title: "Test Album",
      date: "2001-06-15",
      "label-info": [{ "catalog-number": "TC-001", label: { name: "Test Label" } }],
    }),
  }),
);
await page.route("**/coverartarchive.org/**", (route) => route.fulfill({ contentType: "image/png", body: PNG_1PX }));

// Fresh library: one UNTAGGED file named "Test Artist - Test Song.mp3"
// (filename convention feeds the lookup) and one tagged file whose tags
// must NOT be overwritten.
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__sensme?.engine.contract()?.algorithmVersion, null, { timeout: 20000 });
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open("sensme", 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  for (const s of ["tracks", "audio"]) await new Promise((res, rej) => { const t = db.transaction(s, "readwrite"); t.objectStore(s).clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
});
await page.evaluate(async () => {
  const mp3 = new Uint8Array(await (await fetch("/tone.mp3")).arrayBuffer());
  const frame = (id, text) => {
    const body = new TextEncoder().encode(text);
    const h = new Uint8Array(10 + 1 + body.length);
    for (let i = 0; i < 4; i++) h[i] = id.charCodeAt(i);
    const len = 1 + body.length;
    h[4] = (len >> 21) & 0x7f; h[5] = (len >> 14) & 0x7f; h[6] = (len >> 7) & 0x7f; h[7] = len & 0x7f;
    h[10] = 3; h.set(body, 11);
    return h;
  };
  const frames = [frame("TIT2", "Keep My Title"), frame("TPE1", "Tagged Artist")];
  const bodyLen = frames.reduce((a, f) => a + f.length, 0);
  const tag = new Uint8Array(10 + bodyLen);
  tag.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00], 0);
  tag[6] = (bodyLen >> 21) & 0x7f; tag[7] = (bodyLen >> 14) & 0x7f; tag[8] = (bodyLen >> 7) & 0x7f; tag[9] = bodyLen & 0x7f;
  let off = 10; for (const f of frames) { tag.set(f, off); off += f.length; }
  await window.__sensme.importFiles([
    { file: new File([mp3], "Test Artist - Test Song.mp3", { type: "audio/mpeg" }), path: "Test Artist - Test Song.mp3" },
    { file: new File([tag, mp3], "tagged.mp3", { type: "audio/mpeg" }), path: "tagged.mp3" },
  ], () => {});
});
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => (document.querySelector(".np-title")?.textContent ?? "").length > 0, null, { timeout: 20000 });

// Run Metadata Lookup through the real menu path.
await page.keyboard.press("o");
await page.waitForSelector(".menu-item");
await page.locator(".menu-item", { hasText: "Metadata Lookup" }).click();

// 1. The discreet corner status line appears (not the first-run modal).
await page.waitForSelector(".status", { timeout: 5000 });
const statusText = await page.textContent(".status");
if (!/Updating track metadata… \d+\/2/.test(statusText ?? "")) throw new Error(`status line: ${statusText}`);
if (await page.locator(".update-card").count() > 0) throw new Error("enrichment showed the first-run modal card");
ok(`discreet corner progress: "${(statusText ?? "").trim()}"`);

// 1b. Esc/✕ must NOT cancel a metadata run (unlike import/rebuild).
await page.keyboard.press("Escape");
await page.keyboard.press("x");
await page.waitForTimeout(300);
if (!(await page.locator(".status").count())) throw new Error("Esc/✕ cancelled the metadata run");
ok("Esc/✕ does not cancel metadata lookup");

// 2. Wait for completion, then check the untagged record was enriched.
await page.waitForFunction(() => !document.querySelector(".status"), null, { timeout: 30000 });
const recs = await page.evaluate(async () => Object.fromEntries((await window.__sensme.allRecords()).map((r) => [r.name, r])));
const untagged = recs["Test Artist - Test Song.mp3"];
if (!untagged) throw new Error("untagged record missing");
if (untagged.title !== "Test Song" || untagged.artist !== "Test Artist" || untagged.album !== "Test Album")
  throw new Error(`tags not filled: ${JSON.stringify({ t: untagged.title, a: untagged.artist, b: untagged.album })}`);
if (untagged.label !== "Test Label" || untagged.catalogNumber !== "TC-001" || untagged.releaseYear !== 2001)
  throw new Error(`label fields wrong: ${JSON.stringify({ l: untagged.label, c: untagged.catalogNumber, y: untagged.releaseYear })}`);
if (!(untagged.artwork && untagged.artwork.length > 0)) throw new Error("artwork not filled");
if (untagged.metaSource !== "musicbrainz") throw new Error(`provenance missing: ${untagged.metaSource}`);
ok("untagged track enriched: title/artist/album/label/catalog/year/artwork + provenance");

if (mbSearchCalls < 2) throw new Error(`523 not retried (search calls: ${mbSearchCalls})`);
ok("transient 523 retried with backoff");

// 3. Tagged record: its own tags win (title untouched).
const tagged = recs["tagged.mp3"];
if (tagged.title !== "Keep My Title" || tagged.artist !== "Tagged Artist")
  throw new Error(`tags overwritten: ${JSON.stringify({ t: tagged.title, a: tagged.artist })}`);
ok("existing tags never overwritten");

// 4. Enrichment persists across reload (cached locally, offline afterwards).
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => (document.querySelector(".np-title")?.textContent ?? "").length > 0, null, { timeout: 20000 });
const after = await page.evaluate(async () => Object.fromEntries((await window.__sensme.allRecords()).map((r) => [r.name, r])));
const a = after["Test Artist - Test Song.mp3"];
if (a.title !== "Test Song" || a.label !== "Test Label" || !(a.artwork && a.artwork.length > 0))
  throw new Error("enrichment did not persist");
ok("enrichment persisted across reload");

// 5. The enriched artwork renders on the now-playing card.
const hasArt = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll(".np-card img, .np-card .artwork, img")];
  return imgs.some((i) => (i.getAttribute("src") ?? "").startsWith("blob:"));
});
if (!hasArt) throw new Error("enriched artwork not rendered");
ok("enriched artwork renders in now-playing");

await browser.close();
console.log("METADATA GATE OK");
