/*
 * Generates the marginal ornament SVGs.
 *
 * Petals, leaves and tendrils are built from parametric curves (sine-swelled
 * petal profiles, serrated leaf profiles, logarithmic spirals) and fitted with
 * Catmull-Rom splines, which gives far more detail than hand-placed ellipses.
 * Repeated geometry is emitted once into <defs> and referenced, which keeps the
 * files small.
 *
 * Run with: node tools/build-ornament.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, "..", "assets");

const TILE_H = 560;

/* ---------------------------------------------------------------- numbers */

const f = (n) => {
  const r = Math.round(n * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toString();
};
const rad = (deg) => (deg * Math.PI) / 180;

/** deterministic pseudo-random so rebuilds are byte-identical */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------------------------------------------- geometry */

function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u,
    b = 3 * t * u * u,
    c = 3 * t * t * u,
    d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

function bezTan(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const dx =
    3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const dy =
    3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  const m = Math.hypot(dx, dy) || 1;
  return [dx / m, dy / m];
}

/** smooth path through points, Catmull-Rom converted to cubic beziers */
function spline(pts, closed = true, tension = 1) {
  const n = pts.length;
  if (n < 2) return "";
  const P = (i) => (closed ? pts[(i + n) % n] : pts[Math.min(n - 1, Math.max(0, i))]);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const p0 = P(i - 1),
      p1 = P(i),
      p2 = P(i + 1),
      p3 = P(i + 2);
    const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return closed ? d + " Z" : d;
}

const petalAxis = (o) => (t) => [o.bend * Math.sin(Math.PI * t) + o.cup * t * t, -o.len * t];
const petalHalf = (o) => (t) =>
  o.wide * Math.pow(Math.sin(Math.PI * t), o.power) * (1 - o.taper * t);

/** petal outline: half-width swells as sin(pi*t)^power, closing to a point at both ends */
function petal(opts) {
  const o = { len: 30, wide: 11, power: 0.78, taper: 0.22, bend: 0, cup: 0, n: 12, ...opts };
  const axis = petalAxis(o);
  const half = petalHalf(o);
  const right = [],
    left = [];
  for (let i = 0; i <= o.n; i++) {
    const t = i / o.n;
    const [ax, ay] = axis(t);
    const w = half(t);
    right.push([ax + w, ay]);
    left.push([ax - w, ay]);
  }
  return right.concat(left.slice(1, -1).reverse());
}

/** midrib plus symmetric lateral veins */
function veins(opts) {
  const o = { power: 0.78, count: 2, bend: 0, cup: 0, taper: 0, ...opts };
  const axis = petalAxis(o);
  const half = petalHalf(o);
  const out = [];
  const rib = [];
  for (let i = 0; i <= 7; i++) rib.push(axis((i / 7) * 0.93));
  out.push(spline(rib, false));
  for (let k = 1; k <= o.count; k++) {
    const start = 0.14 + (k / (o.count + 1)) * 0.4;
    for (const side of [1, -1]) {
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = start + (i / 6) * (0.84 - start);
        const [ax, ay] = axis(t);
        const spread = Math.sin((Math.PI * (t - start)) / (0.92 - start)) * 0.6;
        pts.push([ax + side * half(t) * spread, ay]);
      }
      out.push(spline(pts, false));
    }
  }
  return out;
}

/** leaf outline with soft serration along the edge */
function leafOutline(opts) {
  const o = { len: 32, wide: 10, teeth: 7, tooth: 1.4, curve: 8, n: 30, ...opts };
  const axis = (t) => [o.curve * t * t, -o.len * t];
  const base = (t) => o.wide * Math.pow(Math.sin(Math.PI * t), 0.6);
  const serrate = (t) =>
    o.tooth * Math.abs(Math.sin(o.teeth * Math.PI * t)) * Math.sin(Math.PI * t);
  const right = [],
    left = [];
  for (let i = 0; i <= o.n; i++) {
    const t = i / o.n;
    const [ax, ay] = axis(t);
    const w = base(t) + serrate(t);
    right.push([ax + w, ay]);
    left.push([ax - w, ay]);
  }
  return right.concat(left.slice(1, -1).reverse());
}

/** logarithmic spiral centreline */
function logSpiral({ a = 1.1, b = 0.4, from = 0, to = 6.6, flip = 1, n = 44 }) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const th = from + ((to - from) * i) / n;
    const r = a * Math.exp(b * th);
    const ang = flip * th;
    pts.push([r * Math.cos(ang), r * Math.sin(ang)]);
  }
  return pts;
}

/** thicken a centreline into a closed outline tapering from w0 to w1 */
function ribbon(pts, w0, w1) {
  const L = pts.length;
  const right = [],
    left = [];
  for (let i = 0; i < L; i++) {
    const t = i / (L - 1);
    const w = (w0 + (w1 - w0) * Math.pow(t, 0.8)) / 2;
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(L - 1, i + 1)];
    let dx = b[0] - a[0],
      dy = b[1] - a[1];
    const m = Math.hypot(dx, dy) || 1;
    dx /= m;
    dy /= m;
    right.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
    left.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  return right.concat(left.reverse());
}

/* ---------------------------------------------------------------- palette */

const GOLD = { light: "#f2e0a2", mid: "#c39b22", deep: "#8a6a15", line: "#6b5011" };

const BLOOMS = {
  crimson: { deep: "#5f0c1c", mid: "#a52a2a", light: "#cf6a54", line: "#460914" },
  magenta: { deep: "#4a0c2c", mid: "#8b2453", light: "#b4658c", line: "#33061e" },
  lapis: { deep: "#111f4c", mid: "#264a90", light: "#6b8fca", line: "#0b1638" },
};

/* --------------------------------------------------- defs, deduplicated */

let defs = [];
let defIndex = new Map();
let uid = 0;

function def(xml) {
  const hit = defIndex.get(xml);
  if (hit) return hit;
  const id = `d${uid++}`;
  defIndex.set(xml, id);
  defs.push(xml.replace("{{id}}", id));
  return id;
}

const use = (id, transform) => `<use href="#${id}"${transform ? ` transform="${transform}"` : ""}/>`;

function resetDefs() {
  defs = [];
  defIndex = new Map();
  uid = 0;
}

/* ------------------------------------------------------------- components */

function bloomDef(hue) {
  const grad = def(
    `<radialGradient id="{{id}}" cx="0.5" cy="0.85" r="0.95">` +
      `<stop offset="0" stop-color="${hue.deep}"/>` +
      `<stop offset="0.4" stop-color="${hue.mid}"/>` +
      `<stop offset="0.85" stop-color="${hue.light}"/>` +
      `<stop offset="1" stop-color="${hue.mid}"/>` +
      `</radialGradient>`
  );
  const gradIn = def(
    `<radialGradient id="{{id}}" cx="0.5" cy="0.85" r="0.95">` +
      `<stop offset="0" stop-color="${hue.deep}"/>` +
      `<stop offset="0.7" stop-color="${hue.mid}"/>` +
      `<stop offset="1" stop-color="${hue.light}"/>` +
      `</radialGradient>`
  );

  const outerGeom = { len: 30, wide: 10.5, power: 0.74, taper: 0.2, bend: 2, cup: 1.2 };
  const outerPath = spline(petal(outerGeom));
  const outerVeins = veins({ ...outerGeom, count: 2 });
  const outerPetal = def(
    `<g id="{{id}}">` +
      `<path d="${outerPath}" fill="url(#${grad})" stroke="${hue.line}" stroke-width="0.85"/>` +
      `<g fill="none" stroke="${hue.deep}" stroke-width="0.55" opacity="0.45">` +
      outerVeins.map((d) => `<path d="${d}"/>`).join("") +
      `</g>` +
      `<path d="${outerPath}" fill="none" stroke="${GOLD.mid}" stroke-width="0.45" opacity="0.5"/>` +
      `</g>`
  );

  const innerGeom = { len: 17.5, wide: 6.8, power: 0.8, taper: 0.24, bend: 1.2, cup: 0.7 };
  const innerPetal = def(
    `<g id="{{id}}"><path d="${spline(petal(innerGeom))}" fill="url(#${gradIn})" ` +
      `stroke="${hue.line}" stroke-width="0.65"/></g>`
  );

  // one stamen, reused around the crown
  const line = [];
  for (let k = 0; k <= 5; k++) {
    const t = k / 5;
    const ang = -Math.PI / 2 + t * 0.34;
    const rr = t * 9.6;
    line.push([Math.cos(ang) * rr, Math.sin(ang) * rr]);
  }
  const tip = line[line.length - 1];
  const stamen = def(
    `<g id="{{id}}">` +
      `<path d="${spline(ribbon(line, 1.5, 0.45))}" fill="${GOLD.mid}"/>` +
      `<circle cx="${f(tip[0])}" cy="${f(tip[1])}" r="1.45" fill="${GOLD.light}" ` +
      `stroke="${GOLD.line}" stroke-width="0.4"/>` +
      `</g>`
  );

  const r = rng(0x9e37);
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = (360 / 6) * i + (r() * 5 - 2.5);
    const s = 0.95 + r() * 0.1;
    parts.push(use(outerPetal, `rotate(${f(a)}) scale(${f(s)})`));
  }
  for (let i = 0; i < 5; i++) {
    const a = (360 / 5) * i + 36 + (r() * 4 - 2);
    parts.push(use(innerPetal, `rotate(${f(a)})`));
  }
  // the gilded crown reads only if it sits above both rings of petals
  for (let i = 0; i < 9; i++) parts.push(use(stamen, `rotate(${f((360 / 9) * i + 6)})`));
  parts.push(
    `<circle r="4.4" fill="${hue.deep}"/>`,
    `<circle r="4.4" fill="none" stroke="${GOLD.mid}" stroke-width="1"/>`
  );
  for (let i = 0; i < 7; i++) {
    const a = rad((360 / 7) * i + 12);
    parts.push(
      `<circle cx="${f(Math.cos(a) * 2.4)}" cy="${f(Math.sin(a) * 2.4)}" r="0.7" fill="${GOLD.light}"/>`
    );
  }
  return def(`<g id="{{id}}">${parts.join("")}</g>`);
}

function rosetteDef() {
  const grad = def(
    `<radialGradient id="{{id}}" cx="0.5" cy="0.5" r="0.62">` +
      `<stop offset="0" stop-color="${GOLD.light}"/>` +
      `<stop offset="0.6" stop-color="${GOLD.mid}"/>` +
      `<stop offset="1" stop-color="${GOLD.deep}"/>` +
      `</radialGradient>`
  );
  const lobe = def(
    `<g id="{{id}}"><path d="${spline(petal({ len: 12.5, wide: 5.2, power: 0.8, taper: 0.18 }))}" ` +
      `fill="url(#${grad})" stroke="${GOLD.line}" stroke-width="0.55"/></g>`
  );
  const parts = [];
  for (let i = 0; i < 6; i++) parts.push(use(lobe, `rotate(${f(60 * i)})`));
  parts.push(
    `<circle r="2.6" fill="${GOLD.deep}"/>`,
    `<circle r="2.6" fill="none" stroke="${GOLD.line}" stroke-width="0.5"/>`,
    `<circle r="1" fill="${GOLD.light}"/>`
  );
  return def(`<g id="{{id}}">${parts.join("")}</g>`);
}

function budDef(hue) {
  const grad = def(
    `<radialGradient id="{{id}}" cx="0.5" cy="0.85" r="0.9">` +
      `<stop offset="0" stop-color="${hue.deep}"/>` +
      `<stop offset="0.55" stop-color="${hue.mid}"/>` +
      `<stop offset="1" stop-color="${hue.light}"/>` +
      `</radialGradient>`
  );
  const sepal = spline(petal({ len: 19, wide: 7.4, power: 0.72, taper: 0.18, bend: 1 }));
  const core = spline(petal({ len: 15.5, wide: 5.2, power: 0.78, taper: 0.2 }));
  const calyx = spline(leafOutline({ len: 11, wide: 5, teeth: 3, tooth: 0.7, curve: 0, n: 20 }));
  return def(
    `<g id="{{id}}">` +
      `<g transform="rotate(-17)"><path d="${sepal}" fill="url(#${grad})" stroke="${hue.line}" stroke-width="0.75"/></g>` +
      `<g transform="rotate(16)"><path d="${sepal}" fill="url(#${grad})" stroke="${hue.line}" stroke-width="0.75"/></g>` +
      `<path d="${core}" fill="${hue.mid}" stroke="${hue.line}" stroke-width="0.65"/>` +
      `<path d="${core}" fill="none" stroke="${GOLD.mid}" stroke-width="0.45" opacity="0.6"/>` +
      `<path d="${calyx}" fill="${GOLD.mid}" stroke="${GOLD.line}" stroke-width="0.55"/>` +
      `</g>`
  );
}

function foliageDefs() {
  const grad = def(
    `<linearGradient id="{{id}}" x1="0" y1="1" x2="1" y2="0">` +
      `<stop offset="0" stop-color="#47592b"/>` +
      `<stop offset="0.55" stop-color="#77863f"/>` +
      `<stop offset="1" stop-color="#a89f57"/>` +
      `</linearGradient>`
  );
  return [
    { len: 32, wide: 10, teeth: 7, tooth: 1.4, curve: 8 },
    { len: 28, wide: 9, teeth: 6, tooth: 1.2, curve: 11 },
    { len: 35, wide: 11, teeth: 8, tooth: 1.5, curve: 6 },
  ].map((geom) => {
    const outline = spline(leafOutline(geom));
    const v = veins({ len: geom.len, wide: geom.wide, power: 0.6, count: 2, cup: geom.curve });
    return def(
      `<g id="{{id}}">` +
        `<path d="${outline}" fill="url(#${grad})" stroke="#3b4f26" stroke-width="0.8"/>` +
        `<path d="${outline}" fill="none" stroke="${GOLD.mid}" stroke-width="0.45" opacity="0.55"/>` +
        `<g fill="none" stroke="#3b4f26" stroke-width="0.55" opacity="0.55">` +
        v.map((d) => `<path d="${d}"/>`).join("") +
        `</g></g>`
    );
  });
}

function tendrilDef(flip) {
  const pts = logSpiral({ a: 1.15, b: 0.44, to: 7.4, flip }).reverse();
  return def(
    `<g id="{{id}}"><path d="${spline(ribbon(pts, 3.8, 0.4))}" fill="${GOLD.mid}" ` +
      `stroke="${GOLD.line}" stroke-width="0.45"/></g>`
  );
}

/* ------------------------------------------------------------ the margins */

const S1 = [
  [70, 0],
  [104, 105],
  [36, 175],
  [70, 280],
];
const S2 = [
  [70, 280],
  [104, 385],
  [36, 455],
  [70, TILE_H],
];

const stemAt = (u) => (u <= 1 ? bez(...S1, u) : bez(...S2, u - 1));
const stemTan = (u) => (u <= 1 ? bezTan(...S1, u) : bezTan(...S2, u - 1));

function normalAngle(u, side) {
  const [tx, ty] = stemTan(u);
  return (Math.atan2(tx * side, -ty * side) * 180) / Math.PI;
}

function gildedStroke(d, w = 5.2) {
  return (
    `<g fill="none" stroke-linecap="round">` +
    `<path d="${d}" stroke="${GOLD.line}" stroke-width="${f(w)}"/>` +
    `<path d="${d}" stroke="${GOLD.mid}" stroke-width="${f(w * 0.69)}"/>` +
    `<path d="${d}" stroke="${GOLD.light}" stroke-width="${f(w * 0.21)}" opacity="0.7"/>` +
    `</g>`
  );
}

function buildVine() {
  resetDefs();

  const crimson = bloomDef(BLOOMS.crimson);
  const magenta = bloomDef(BLOOMS.magenta);
  const lapis = bloomDef(BLOOMS.lapis);
  const rose = rosetteDef();
  const budCrimson = budDef(BLOOMS.crimson);
  const budMagenta = budDef(BLOOMS.magenta);
  const leaves = foliageDefs();
  const curlR = tendrilDef(1);
  const curlL = tendrilDef(-1);

  const stemD =
    `M${f(S1[0][0])} ${f(S1[0][1])}` +
    ` C${f(S1[1][0])} ${f(S1[1][1])} ${f(S1[2][0])} ${f(S1[2][1])} ${f(S1[3][0])} ${f(S1[3][1])}` +
    ` C${f(S2[1][0])} ${f(S2[1][1])} ${f(S2[2][0])} ${f(S2[2][1])} ${f(S2[3][0])} ${f(S2[3][1])}`;

  const body = [gildedStroke(stemD)];

  /* Every ornament has to sit wholly inside the tile. The tile repeats, but the
     element drawing it also has a top and bottom edge where the terminal sprays
     join, and anything overhanging the box would be sliced there. */
  const place = (xml) => body.push(xml);

  // offshoots carrying the blooms
  const shoots = [
    { u: 0.26, side: 1, to: [106, 78] },
    { u: 0.74, side: -1, to: [34, 212] },
    { u: 1.26, side: 1, to: [104, 358] },
    { u: 1.74, side: -1, to: [35, 492] },
  ];
  for (const s of shoots) {
    const p = stemAt(s.u);
    const [tx, ty] = stemTan(s.u);
    const c1 = [p[0] - ty * 18 * s.side, p[1] + tx * 18 * s.side];
    const c2 = [(c1[0] + s.to[0]) / 2, s.to[1] + (p[1] < s.to[1] ? -14 : 14)];
    const d = `M${f(p[0])} ${f(p[1])} C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(
      s.to[0]
    )} ${f(s.to[1])}`;
    place(gildedStroke(d, 3.4));
  }

  // gilded tendrils spiralling off the stem
  const curls = [
    { u: 0.2, side: 1, scale: 1 },
    { u: 0.42, side: -1, scale: 0.86 },
    { u: 0.6, side: 1, scale: 0.94 },
    { u: 0.92, side: -1, scale: 0.8 },
    { u: 1.08, side: 1, scale: 0.98 },
    { u: 1.44, side: -1, scale: 0.9 },
    { u: 1.6, side: 1, scale: 0.84 },
    { u: 1.8, side: -1, scale: 0.96 },
  ];
  for (const c of curls) {
    const p = stemAt(c.u);
    place(
      `<g transform="translate(${f(p[0])} ${f(p[1])}) rotate(${f(
        normalAngle(c.u, c.side)
      )}) scale(${f(c.scale)})">${use(c.side > 0 ? curlR : curlL)}</g>`
    );
  }

  // foliage along the stem
  const foliagePlan = [
    { u: 0.16, side: 1, s: 0.98, v: 0 },
    { u: 0.34, side: -1, s: 0.9, v: 2 },
    { u: 0.5, side: 1, s: 0.82, v: 1 },
    { u: 0.58, side: -1, s: 0.94, v: 0 },
    { u: 0.84, side: 1, s: 0.86, v: 2 },
    { u: 0.98, side: -1, s: 0.98, v: 1 },
    { u: 1.16, side: 1, s: 0.96, v: 0 },
    { u: 1.34, side: -1, s: 0.88, v: 2 },
    { u: 1.5, side: 1, s: 0.8, v: 1 },
    { u: 1.58, side: -1, s: 0.92, v: 0 },
    { u: 1.84, side: 1, s: 0.88, v: 2 },
  ];
  for (const l of foliagePlan) {
    const p = stemAt(l.u);
    place(
      `<g transform="translate(${f(p[0])} ${f(p[1])}) rotate(${f(
        normalAngle(l.u, l.side) + 90 * l.side
      )}) scale(${f(l.s * l.side)} ${f(l.s)})">${use(leaves[l.v])}</g>`
    );
  }

  // blooms, buds and rosettes
  const at = (id, x, y, rot, scale) =>
    `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(scale)})">${use(id)}</g>`;

  place(at(crimson, 106, 78, -18, 1));
  place(at(rose, stemAt(0.5)[0], stemAt(0.5)[1], 14, 1));
  place(at(magenta, 34, 212, 14, 0.9));
  place(at(budCrimson, stemAt(1)[0] + 4, stemAt(1)[1], 18, 1));
  place(at(lapis, 104, 358, -12, 0.94));
  place(at(rose, stemAt(1.5)[0], stemAt(1.5)[1], -10, 0.86));
  place(at(budMagenta, 35, 492, -152, 0.9));
  // small rosettes either side of the seam, so the repeat has no bare stretch
  place(at(rose, stemAt(0.14)[0], stemAt(0.14)[1], -18, 0.66));
  place(at(rose, stemAt(1.86)[0], stemAt(1.86)[1], 22, 0.7));

  return wrap(`0 0 140 ${TILE_H}`, 140, TILE_H, body);
}

function buildTip() {
  resetDefs();
  const crimson = bloomDef(BLOOMS.crimson);
  const leaves = foliageDefs();
  const curlR = tendrilDef(1);
  const curlL = tendrilDef(-1);

  // the stem leaves the bottom edge on the same tangent the tile enters on, so
  // the join with the repeating vine reads as one continuous stem
  const body = [gildedStroke("M70 150 C61 124 78 100 70 66")];

  body.push(`<g transform="translate(76 128) rotate(-28) scale(0.92)">${use(curlR)}</g>`);
  body.push(`<g transform="translate(64 106) rotate(214) scale(0.82)">${use(curlL)}</g>`);

  body.push(`<g transform="translate(78 134) rotate(-58) scale(0.96)">${use(leaves[0])}</g>`);
  body.push(`<g transform="translate(62 118) rotate(236) scale(-0.9 0.9)">${use(leaves[2])}</g>`);
  body.push(`<g transform="translate(70 92) rotate(-46) scale(0.78)">${use(leaves[1])}</g>`);

  body.push(`<g transform="translate(70 56) scale(1.02)">${use(crimson)}</g>`);

  return wrap("0 0 140 150", 140, 150, body);
}

function wrap(viewBox, w, h, body) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}">\n` +
    `<!-- Generated by tools/build-ornament.mjs. Edit the generator, not this file. -->\n` +
    `<defs>${defs.join("")}</defs>\n` +
    body.join("\n") +
    `\n</svg>\n`
  );
}

mkdirSync(ASSETS, { recursive: true });
for (const [name, svg] of [
  ["vine.svg", buildVine()],
  ["vine-tip.svg", buildTip()],
]) {
  writeFileSync(resolve(ASSETS, name), svg);
  console.log(`${name.padEnd(14)} ${(svg.length / 1024).toFixed(1)} KB`);
}
