// Renders the app icon (SVG) to the PNG sizes the manifest and iOS need. Run: node scripts/icons.mjs
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const mark = (bg, fg, pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${bg}"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})" fill="none" stroke="${fg}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">
    <path d="M112 244 L256 128 L400 244"/>
    <path d="M152 214 V384 H360 V214"/>
    <path d="M226 384 V304 H286 V384"/>
  </g>
</svg>`;

const variants = [
  { name: "icon-192.png", size: 192, svg: mark("#0a0a0a", "#ededed", 40) },
  { name: "icon-512.png", size: 512, svg: mark("#0a0a0a", "#ededed", 40) },
  { name: "maskable-512.png", size: 512, svg: mark("#1f6f4a", "#ffffff", 110) },
  { name: "maskable-192.png", size: 192, svg: mark("#1f6f4a", "#ffffff", 110) },
  { name: "apple-touch-icon.png", size: 180, svg: mark("#0a0a0a", "#ededed", 60) },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const v of variants) {
  await page.setViewportSize({ width: v.size, height: v.size });
  await page.setContent(`<html><body style="margin:0">${v.svg.replace("<svg ", `<svg width="${v.size}" height="${v.size}" `)}</body></html>`);
  writeFileSync(`public/icons/${v.name}`, await page.screenshot({ type: "png" }));
}
writeFileSync("public/icons/icon.svg", mark("#0a0a0a", "#ededed", 40));
await browser.close();
console.log("icons written");
