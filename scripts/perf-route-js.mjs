// Measures the gzip size of the JavaScript each route's server HTML references (first load).
// Usage: start a production server on :3006 (node scripts/local-env.mjs next start -p 3006), then node scripts/perf-route-js.mjs
import { chromium } from "@playwright/test";
import { gzipSync } from "node:zlib";
const base = "http://localhost:3006";
const b = await chromium.launch();
const ctx = await b.newContext({ serviceWorkers: "block" });
const p = await ctx.newPage();
await p.goto(`${base}/connexion`, { waitUntil: "networkidle" });
await p.fill("input[type=email]", "demo.a@chez-nous.local");
await p.fill("input[type=password]", "demo-chez-nous");
await p.click("form button[type=submit]");
await p.waitForURL(`${base}/`);
const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
for (const path of ["/", "/depenses", "/listes", "/budget"]) {
  const html = await (await fetch(base + path, { headers: { cookie } })).text();
  const srcs = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]))];
  let gz = 0;
  for (const s of srcs) gz += gzipSync(Buffer.from(await (await fetch(base + s)).arrayBuffer()), { level: 9 }).length;
  if (path === "/") {
    for (const s of srcs) {
      const body = await (await fetch(base + s)).text();
      const tags = ["RealtimeClient", "vaul", "cmdk", "browser-image-compression", "number-flow", "react-markdown", "imageCompression", "GoTrue", "PostgrestClient"].filter((t) => body.includes(t));
      console.log(Math.round(gzipSync(Buffer.from(body)).length / 1024), s.split("/").pop(), tags.join(","));
    }
  }
  console.log(path, "route JS referenced by the HTML:", Math.round(gz / 1024), "KB gzip in", srcs.length, "files");
}
await b.close();
