// Generates tokens.ts and tokens.css from tokens.json (single source of truth).
// Run: node contracts/design-tokens/generate.mjs
import { readFileSync, writeFileSync } from "node:fs";

const t = JSON.parse(readFileSync(new URL("./tokens.json", import.meta.url), "utf8"));

// ---- tokens.ts -------------------------------------------------------------
const ts = `// GENERATED from tokens.json by generate.mjs — do not edit by hand.
export const tokens = ${JSON.stringify(t, null, 2)} as const;

export type Tokens = typeof tokens;
export const cssVar = (path: string): string =>
  \`--moodwave-\${path.replace(/\\./g, "-")}\`;
`;
writeFileSync(new URL("./tokens.ts", import.meta.url), ts);

// ---- tokens.css ------------------------------------------------------------
const lines = [":root {"];
const flat = (prefix, obj) => {
  for (const [k, v] of Object.entries(obj)) {
    const name = prefix ? `${prefix}-${k}` : k;
    if (typeof v === "number" || typeof v === "string") {
      lines.push(`  --moodwave-${name}: ${v};`);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => lines.push(`  --moodwave-${name}-${i}: ${item};`));
    } else {
      flat(name, v);
    }
  }
};
flat("", { color: t.color, layout: t.layout, type: t.type, motion: t.motion });
lines.push("}");
writeFileSync(new URL("./tokens.css", import.meta.url), lines.join("\n") + "\n");
console.log("generated tokens.ts, tokens.css");
