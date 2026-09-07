/*
 * Checks the generated ornament against the lines the browser will cut it on.
 *
 * The margin is a repeating background, so the tile is sliced wherever the
 * element ends. The stylesheet snaps that height to a multiple of half a tile,
 * and the stem passes x = 70 on the same tangent at y = 0, 280 and 560 — so a
 * cut on any of those lines joins invisibly, provided no ornament straddles
 * one. Anything that does gets sliced flat, which is what a "break in the
 * vine" looks like.
 *
 * Run with: node tools/audit-ornament.mjs   (needs the dev server)
 */

import { createRequire } from "node:module";

const puppeteer = createRequire(import.meta.url)(
  process.env.PUPPETEER || "/tmp/gesserit-test/node_modules/puppeteer-core"
);

const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:8770";
const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const CHECKS = [
  { file: "vine.svg", cuts: [0, 280, 560] },
  { file: "vine-tip.svg", cuts: [] },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
let failures = 0;

for (const { file, cuts } of CHECKS) {
  await page.goto(`${ORIGIN}/assets/${file}?${Date.now()}`, { waitUntil: "load" });
  const { w, h, boxes } = await page.evaluate(() => {
    const svg = document.querySelector("svg");
    const vb = svg.viewBox.baseVal;
    const art = document.getElementById("art");
    // out of <defs> it would have no layout box, so measure it in the document
    if (art.parentElement.tagName === "defs") svg.appendChild(art);
    const host = svg.getBoundingClientRect();
    const sx = vb.width / host.width;
    const sy = vb.height / host.height;
    return {
      w: vb.width,
      h: vb.height,
      boxes: [...art.children].map((g, i) => {
        const r = g.getBoundingClientRect();
        return {
          i,
          continuous: g.dataset.cut === "continuous",
          x: (r.left - host.left) * sx,
          r: (r.right - host.left) * sx,
          y: (r.top - host.top) * sy,
          b: (r.bottom - host.top) * sy,
        };
      }),
    };
  });

  const problems = [];
  for (const box of boxes) {
    if (box.x < -0.5 || box.r > w + 0.5)
      problems.push(`child ${box.i} runs off the side (x ${box.x.toFixed(1)}..${box.r.toFixed(1)})`);
    if (box.continuous) continue;
    for (const cut of cuts) {
      // touching a cut line is fine; spanning it is not
      if (box.y < cut - 0.5 && box.b > cut + 0.5)
        problems.push(
          `child ${box.i} straddles y=${cut} (y ${box.y.toFixed(1)}..${box.b.toFixed(1)})`
        );
    }
  }
  failures += problems.length;
  console.log(`${file}: ${problems.length ? problems.join("\n  ") : "clean"}`);
  if (problems.length) console.log();
}

await browser.close();
console.log(failures ? `\n${failures} problem(s)` : "\nall clear");
process.exit(failures ? 1 : 0);
