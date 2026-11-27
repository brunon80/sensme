// Renders the branding concept SVGs in this folder into 512px PNG previews.
// Run from the repo root: node docs/branding/concepts/render.mjs
import { createRequire } from "node:module";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
// playwright is a dependency of apps/web; resolve it from there.
const require = createRequire(path.join(dir, "../../../apps/web/package.json"));
const { chromium } = require("playwright");

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? undefined,
});
const page = await browser.newPage();

for (const file of readdirSync(dir).filter((f) => f.endsWith("-icon.svg"))) {
  const dataUrl =
    "data:image/svg+xml;base64," +
    Buffer.from(await import("node:fs/promises").then((fs) => fs.readFile(path.join(dir, file)))).toString("base64");
  const png = await page.evaluate(
    async ([src]) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src;
      });
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 512;
      c.getContext("2d").drawImage(img, 0, 0, 512, 512);
      return c.toDataURL("image/png");
    },
    [dataUrl],
  );
  writeFileSync(path.join(dir, file.replace(/\.svg$/, ".png")), Buffer.from(png.split(",")[1], "base64"));
  console.log("wrote", file.replace(/\.svg$/, ".png"));
}

await browser.close();
