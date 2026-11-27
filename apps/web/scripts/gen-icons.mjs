// Renders public/icon.svg into the PNG icons required by the PWA manifest
// (192, 512, and a maskable 512 with safe-zone padding). Run: node scripts/gen-icons.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, "../public/icons");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  // Use the locally cached Chromium build (avoids a browser download when
  // the installed Playwright version expects a different build number).
  executablePath: process.env.CHROME_PATH ?? undefined,
});
const page = await browser.newPage();

async function render(svgFile, size, pad, fill) {
  const dataUrl =
    "data:image/svg+xml;base64," +
    Buffer.from(await import("node:fs/promises").then((fs) => fs.readFile(path.join(root, "../public", svgFile)))).toString("base64");
  return page.evaluate(
    async ([src, size, pad, fill]) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src;
      });
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const x = c.getContext("2d");
      x.fillStyle = fill;
      x.fillRect(0, 0, size, size);
      const s = size * pad;
      const ar = img.width / img.height;
      let w = s;
      let h = s;
      if (ar > 1) h = s / ar;
      else w = s * ar;
      x.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      return c.toDataURL("image/png");
    },
    [dataUrl, size, pad, fill],
  );
}

// Regular icons: the tile (white rounded square) fills the canvas.
// Maskable: full-bleed white with the bare mark inside the safe zone, so
// launcher circular/squircle masks never cut the bars.
for (const [name, svg, size, pad, fill] of [
  ["icon-192.png", "icon.svg", 192, 1.0, "#fff"],
  ["icon-512.png", "icon.svg", 512, 1.0, "#fff"],
  ["icon-maskable-512.png", "icon-mark.svg", 512, 0.62, "#fff"],
]) {
  const dataUrl = await render(svg, size, pad, fill);
  writeFileSync(path.join(outDir, name), Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("wrote", name);
}

await browser.close();
