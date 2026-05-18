#!/usr/bin/env node
// Rasterizes apps/web/public/icon.svg to the PWA PNG sizes.
// Run on demand: `node apps/web/scripts/build-icons.mjs`
// Requires playwright (already a devDependency).

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const SIZES = [
  { file: "icon-192.png", size: 192, padding: 0 },
  { file: "icon-512.png", size: 512, padding: 0 },
  // Maskable icons need a safe zone inside the canvas (Android crops to a
  // shape). Keep the artwork inside the central 80% so corners can be cut.
  { file: "icon-maskable-512.png", size: 512, padding: 0.1 },
];

async function main() {
  const svg = await readFile(join(publicDir, "icon.svg"), "utf8");
  const browser = await chromium.launch();

  for (const { file, size, padding } of SIZES) {
    const innerPct = (1 - padding * 2) * 100;
    const offsetPct = padding * 100;
    const html = `
      <html><body style="margin:0;padding:0;background:#0a0a0a;">
        <div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:#0a0a0a;">
          <div style="width:${innerPct}%;height:${innerPct}%;margin:${offsetPct}% ${offsetPct}%;">${svg.replace("<svg ", `<svg width="100%" height="100%" `)}</div>
        </div>
      </body></html>`;
    const ctx = await browser.newContext({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    await page.setContent(html);
    const buf = await page.screenshot({ omitBackground: false, type: "png" });
    await writeFile(join(publicDir, file), buf);
    await ctx.close();
    console.log(`wrote ${file} (${size}x${size})`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
