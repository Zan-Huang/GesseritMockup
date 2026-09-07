/*
 * Generates the marginal ornament SVGs.
 *
 * Forms are built from parametric curves and fitted with Catmull-Rom splines:
 * acanthus leaves are lobed ribbons swept along a curling spine, petals are
 * sine-swelled profiles, tendrils are logarithmic spirals.
 *
 * Three motifs are drawn from technical rather than botanical sources, in the
 * manner of a manuscript that hides meaning in its margins:
 *   - the seed head sets its seeds by Vogel's model at the golden angle,
 *     137.507 degrees, the true phyllotaxis of a sunflower or pomegranate
 *   - the twisted tendrils are double helices, strands and base pairs
 *   - the gilded bosses are astrolabes, with limb, graduations and alidade
 *
 * Painted rather than printed: everything is outlined in iron-gall ink, lifted
 * with lead-white heightening, mottled with a pigment wash and nudged off true
 * by a displacement filter so no edge is mechanically exact.
 *
 * Run with: node tools/build-ornament.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, "..", "assets");

const TILE_W = 140;
const TILE_H = 560;
const GOLDEN_ANGLE = 137.507764;

/* ---------------------------------------------------------------- numbers */

const f = (n) => {
  const r = Math.round(n * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toString();
};
const rad = (deg) => (deg * Math.PI) / 180;

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

/** sample a cubic bezier into a polyline */
function sampleBez(p0, p1, p2, p3, n = 40) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(bez(p0, p1, p2, p3, i / n));
  return pts;
}

/** unit tangent of a polyline at index i */
function tangentAt(pts, i) {
  const a = pts[Math.max(0, i - 1)];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  let dx = b[0] - a[0],
    dy = b[1] - a[1];
  const m = Math.hypot(dx, dy) || 1;
  return [dx / m, dy / m];
}

/** unit normal of a polyline at index i */
function normalAt(pts, i) {
  const [tx, ty] = tangentAt(pts, i);
  return [-ty, tx];
}

/** position, tangent and normal at parameter t along a polyline */
function frameAt(pts, t) {
  const n = pts.length - 1;
  const i = Math.round(Math.min(n, Math.max(0, t * n)));
  return { p: pts[i], t: tangentAt(pts, i), n: normalAt(pts, i) };
}

/**
 * A Catmull-Rom spline has zero tangent wherever a point is repeated, so a
 * tripled anchor comes to a cusp. That is how the lobe tips are made sharp
 * without breaking the outline into separate paths.
 */
const CUSP = (pt) => [pt, pt, pt];

/** sweep a variable half-width along a spine, returning a closed outline */
function spineOutline(pts, halfWidth) {
  const L = pts.length;
  const right = [],
    left = [];
  for (let i = 0; i < L; i++) {
    const t = i / (L - 1);
    const w = halfWidth(t);
    const [nx, ny] = normalAt(pts, i);
    right.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
    left.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  return right.concat(left.slice(1, -1).reverse());
}

/** petal: sine-swelled profile on a bending spine */
function petal(opts) {
  const o = { len: 30, wide: 10.5, power: 0.76, taper: 0.2, curve: 0, n: 16, ...opts };
  const spine = [];
  for (let i = 0; i <= o.n; i++) {
    const t = i / o.n;
    spine.push([o.curve * t * t, -o.len * t]);
  }
  return spineOutline(spine, (t) =>
    o.wide * Math.pow(Math.sin(Math.PI * t), o.power) * (1 - o.taper * t)
  );
}

/**
 * Acanthus leaf: the spine curls over at the tip and the half-width is an
 * envelope modulated by |sin| so the edge breaks into lobes.
 */
/** leaf with a soft serrated edge */
function serratedLeaf(opts) {
  const o = { len: 30, wide: 9.5, teeth: 7, tooth: 1.3, curve: 9, n: 34, ...opts };
  const spine = [];
  for (let i = 0; i <= o.n; i++) {
    const t = i / o.n;
    spine.push([o.curve * t * t, -o.len * t]);
  }
  return spineOutline(
    spine,
    (t) =>
      o.wide * Math.pow(Math.sin(Math.PI * t), 0.6) +
      o.tooth * Math.abs(Math.sin(o.teeth * Math.PI * t)) * Math.sin(Math.PI * t)
  );
}

function logSpiral({ a = 1.15, b = 0.44, to = 7.4, flip = 1, n = 44 }) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const th = (to * i) / n;
    const r = a * Math.exp(b * th);
    pts.push([r * Math.cos(flip * th), r * Math.sin(flip * th)]);
  }
  return pts;
}

function ribbon(pts, w0, w1) {
  return spineOutline(pts, (t) => (w0 + (w1 - w0) * Math.pow(t, 0.8)) / 2);
}

/* ------------------------------------------------- pigments and gilding */

const INK = "#3a2c1c";
const WHITE = "#f6f1e2";

const GILD = {
  light: "#f0dc9c",
  mid: "#c09a2c",
  deep: "#96731c",
  tool: "#6d5210",
};

/* ground pigments, after the usual manuscript palette */
const PIGMENT = {
  gold: { deep: GILD.deep, mid: GILD.mid, light: GILD.light },
  vermilion: { deep: "#7c2213", mid: "#b0402a", light: "#d1795c" },
  madder: { deep: "#54172c", mid: "#8b3048", light: "#b06d80" },
  ultramarine: { deep: "#1b2f6b", mid: "#2f4f96", light: "#7392c6" },
  azurite: { deep: "#1d4560", mid: "#3a6f92", light: "#7ba3bd" },
  verdigris: { deep: "#2f4630", mid: "#54704a", light: "#8fa471" },
  terreverte: { deep: "#414b2a", mid: "#6d7a4c", light: "#a4a878" },
};

/* -------------------------------------------------- defs, deduplicated */

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

/** a pigment wash: dark at the base of the form, lifting toward the edge */
function washGradient(p, angle = 0) {
  return def(
    `<linearGradient id="{{id}}" x1="0" y1="1" x2="${f(Math.sin(rad(angle)))}" y2="0">` +
      `<stop offset="0" stop-color="${p.deep}"/>` +
      `<stop offset="0.52" stop-color="${p.mid}"/>` +
      `<stop offset="1" stop-color="${p.light}"/>` +
      `</linearGradient>`
  );
}

function gildGradient() {
  return def(
    `<linearGradient id="{{id}}" x1="0" y1="0" x2="0.8" y2="1">` +
      `<stop offset="0" stop-color="${GILD.light}"/>` +
      `<stop offset="0.34" stop-color="${GILD.mid}"/>` +
      `<stop offset="0.62" stop-color="${GILD.light}"/>` +
      `<stop offset="1" stop-color="${GILD.deep}"/>` +
      `</linearGradient>`
  );
}

/* ------------------------------------------------------------ components */

/**
 * Acanthus leaf. One continuous silhouette around a curling rib: the edge runs
 * out to a pointed lobe, back to a cleft cut nearly to the rib, and out again,
 * every tip thrown forward toward the leaf's point. The clefts are then scored
 * in ink and the lobes heightened in lead white, the way the form is built up
 * in a painted border.
 */
function acanthusDef(
  p,
  { len = 48, wide = 13, lobes = 5, cleft = 0.45, forward = 0.38, inner = 0.66 } = {}
) {
  const wash = washGradient(p, 28);

  const rib = sampleBez(
    [0, 0],
    [0.04 * len, -0.52 * len],
    [0.46 * len, -0.95 * len],
    [0.86 * len, -0.56 * len],
    40
  );
  const half = (t) => wide * Math.pow(Math.sin(Math.PI * t), 0.42) * (1 - 0.18 * t);

  /** a point on the edge: out along the normal by a fraction of the half-width */
  const edgePt = (t, side, scale, frac, fwd = 0) => {
    const fr = frameAt(rib, t);
    const w = half(t) * scale;
    return [
      fr.p[0] + fr.n[0] * side * w * frac + fr.t[0] * fwd * w,
      fr.p[1] + fr.n[1] * side * w * frac + fr.t[1] * fwd * w,
    ];
  };
  const cleftPt = (t, side, scale) => edgePt(t, side, scale, cleft);
  const tipPt = (t, side, scale) => edgePt(t, side, scale, 1, forward);

  /**
   * Anchors for one edge, base to point. Each lobe gets a shoulder before the
   * tip so its leading edge swells, and another after it so the fall back to
   * the cleft stays concave instead of collapsing into a V.
   */
  const edge = (side, scale) => {
    const pts = [];
    for (let k = 0; k < lobes; k++) {
      pts.push(cleftPt(k / lobes, side, scale));
      pts.push(edgePt((k + 0.32) / lobes, side, scale, 0.86));
      pts.push(...CUSP(tipPt((k + 0.7) / lobes, side, scale)));
      pts.push(edgePt((k + 0.88) / lobes, side, scale, 0.48));
    }
    return pts;
  };

  const outline = [
    ...CUSP(rib[0]),
    ...edge(-1, 1),
    ...CUSP(frameAt(rib, 1).p),
    ...edge(1, inner).reverse(),
  ];

  const silhouette = spline(outline);
  const parts = [
    `<path d="${silhouette}" fill="url(#${wash})" stroke="${INK}" stroke-width="0.85" ` +
      `stroke-linejoin="round"/>`,
    // a thread of gold inside the ink line, as gilt-edged foliage carries
    `<path d="${silhouette}" fill="none" stroke="${GILD.mid}" stroke-width="0.6" opacity="0.45" ` +
      `transform="scale(0.965)"/>`,
  ];

  const scores = [];
  const heightening = [];
  for (const [side, scale] of [
    [-1, 1],
    [1, inner],
  ]) {
    for (let k = 0; k < lobes; k++) {
      const t = k / lobes;
      const onRib = frameAt(rib, t).p;
      const c = lerp(cleftPt(t, side, scale), onRib, 0.4);
      scores.push(`M${f(c[0])} ${f(c[1])} L${f(onRib[0])} ${f(onRib[1])}`);

      const tv = (k + 0.7) / lobes;
      const tip = tipPt(tv, side, scale);
      const root = frameAt(rib, Math.max(0.05, t + 0.03)).p;
      const bow = frameAt(rib, tv).n;
      const mid = lerp(root, tip, 0.55);
      scores.push(
        `M${f(root[0])} ${f(root[1])} Q${f(mid[0] + bow[0] * side * 1.4)} ${f(
          mid[1] + bow[1] * side * 1.4
        )} ${f(tip[0])} ${f(tip[1])}`
      );
      const from = lerp(root, tip, 0.24);
      const to = lerp(root, tip, 0.86);
      heightening.push(
        `M${f(from[0])} ${f(from[1])} Q${f(mid[0] + bow[0] * side * 2.6)} ${f(
          mid[1] + bow[1] * side * 2.6
        )} ${f(to[0])} ${f(to[1])}`
      );
    }
  }

  parts.push(
    `<g fill="none" stroke="${INK}" stroke-width="0.5" opacity="0.42">` +
      scores.map((d) => `<path d="${d}"/>`).join("") +
      `</g>`,
    `<g fill="none" stroke="${WHITE}" stroke-width="0.85" opacity="0.32" stroke-linecap="round">` +
      heightening.map((d) => `<path d="${d}"/>`).join("") +
      `</g>`,
    `<path d="${spline(rib.slice(0, 38), false)}" fill="none" stroke="${INK}" stroke-width="0.7" opacity="0.5"/>`,
    `<path d="${spline(rib.slice(2, 34), false)}" fill="none" stroke="${GILD.mid}" stroke-width="0.6" opacity="0.65"/>`
  );
  return def(`<g id="{{id}}">${parts.join("")}</g>`);
}

const lerp = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];


/** many-petalled flower, two courses of petals, gilded crown, ink outlines */
function bloomDef(p, { courses = 2, outer = 6, inner = 5, len = 27, wide = 9.5 } = {}) {
  const wash = washGradient(p, 12);
  const washIn = washGradient({ deep: p.deep, mid: p.deep, light: p.mid }, 40);
  const gild = gildGradient();

  const geom = { len, wide, power: 0.72, taper: 0.2, curve: 2.4 };
  const petalPath = spline(petal(geom));
  const petalRibs = (() => {
    const spine = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      spine.push([geom.curve * t * t, -geom.len * t]);
    }
    const rib = spline(spine.slice(0, 9), false);
    const side = (s) =>
      spline(
        spine.slice(1, 8).map((pt, i) => {
          const t = (i + 1) / 10;
          return [pt[0] + s * geom.wide * 0.5 * Math.sin(Math.PI * t), pt[1]];
        }),
        false
      );
    return [rib, side(1), side(-1)];
  })();

  const outerPetal = def(
    `<g id="{{id}}">` +
      `<path d="${petalPath}" fill="url(#${wash})" stroke="${INK}" stroke-width="0.8"/>` +
      `<g fill="none" stroke="${p.deep}" stroke-width="0.5" opacity="0.5">` +
      petalRibs.map((d) => `<path d="${d}"/>`).join("") +
      `</g>` +
      `<path d="${petalRibs[0]}" fill="none" stroke="${WHITE}" stroke-width="0.7" opacity="0.34" transform="translate(0.7 0)"/>` +
      `</g>`
  );

  const innerPetal = def(
    `<g id="{{id}}"><path d="${spline(
      petal({ len: len * 0.58, wide: wide * 0.66, power: 0.8, taper: 0.24, curve: 1.4 })
    )}" fill="url(#${washIn})" stroke="${INK}" stroke-width="0.65"/></g>`
  );

  // one stamen, repeated around the crown
  const stalk = [];
  for (let k = 0; k <= 5; k++) {
    const t = k / 5;
    const ang = -Math.PI / 2 + t * 0.3;
    stalk.push([Math.cos(ang) * t * 8.8, Math.sin(ang) * t * 8.8]);
  }
  const tip = stalk[stalk.length - 1];
  const stamen = def(
    `<g id="{{id}}">` +
      `<path d="${spline(ribbon(stalk, 1.4, 0.4))}" fill="url(#${gild})" stroke="${GILD.tool}" stroke-width="0.3"/>` +
      `<circle cx="${f(tip[0])}" cy="${f(tip[1])}" r="1.4" fill="${GILD.light}" stroke="${GILD.tool}" stroke-width="0.4"/>` +
      `</g>`
  );

  const r = rng(0x51ed);
  const parts = [];
  for (let i = 0; i < outer; i++) {
    parts.push(
      use(outerPetal, `rotate(${f((360 / outer) * i + r() * 6 - 3)}) scale(${f(0.95 + r() * 0.1)})`)
    );
  }
  if (courses > 1) {
    for (let i = 0; i < inner; i++) {
      parts.push(use(innerPetal, `rotate(${f((360 / inner) * i + 180 / inner + r() * 4 - 2)})`));
    }
  }
  for (let i = 0; i < 9; i++) parts.push(use(stamen, `rotate(${f((360 / 9) * i + 6)})`));
  parts.push(
    `<circle r="4.2" fill="${p.deep}" stroke="${INK}" stroke-width="0.6"/>`,
    `<circle r="4.2" fill="none" stroke="${GILD.mid}" stroke-width="0.9"/>`
  );
  for (let i = 0; i < 7; i++) {
    const a = rad((360 / 7) * i + 12);
    parts.push(
      `<circle cx="${f(Math.cos(a) * 2.3)}" cy="${f(Math.sin(a) * 2.3)}" r="0.7" fill="${GILD.light}"/>`
    );
  }
  return def(`<g id="{{id}}">${parts.join("")}</g>`);
}

/**
 * Seed head after Vogel's model: the nth seed sits at angle n * 137.507 deg and
 * radius c * sqrt(n), the packing a sunflower actually uses. Wrapped in a
 * pomegranate's calyx, the way a manuscript would render it.
 */
function seedHeadDef(p, { seeds = 68, c = 2.05 } = {}) {
  const wash = washGradient(p, 20);
  const gild = gildGradient();
  const hull = spline(
    (() => {
      const pts = [];
      const R = c * Math.sqrt(seeds) + 4.6;
      for (let i = 0; i < 22; i++) {
        const a = (TAU_DEG(i, 22));
        const squash = 1 + 0.1 * Math.cos(2 * rad(a));
        pts.push([Math.cos(rad(a)) * R * squash, Math.sin(rad(a)) * R * 1.06]);
      }
      return pts;
    })()
  );

  const parts = [
    `<path d="${hull}" fill="url(#${wash})" stroke="${INK}" stroke-width="0.95"/>`,
    `<path d="${hull}" fill="none" stroke="${GILD.mid}" stroke-width="0.6" opacity="0.55" transform="scale(0.94)"/>`,
  ];

  /* The phyllotactic field. Seeds 13 apart in the sequence lie along one of
     the thirteen spiral arms, so gilding every thirteenth picks a single
     parastichy out of the packing in gold. */
  for (let n = 1; n <= seeds; n++) {
    const a = rad(n * GOLDEN_ANGLE);
    const r = c * Math.sqrt(n);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * 1.04;
    const s = 1.75 - 0.25 * (n / seeds);
    parts.push(
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(s)}" fill="${n % 13 === 0 ? GILD.light : p.light}" ` +
        `stroke="${INK}" stroke-width="0.34" opacity="0.95"/>`
    );
  }

  // the pomegranate's crown of sepals, splayed off the shoulder of the fruit
  const sepal = spline(petal({ len: 11, wide: 3.2, power: 0.85, taper: 0.15 }));
  const R = c * Math.sqrt(seeds) + 3;
  for (const deg of [-52, -26, 0, 26, 52]) {
    const a = rad(deg - 90);
    parts.push(
      `<g transform="translate(${f(Math.cos(a) * R * 0.92)} ${f(
        Math.sin(a) * R * 0.92
      )}) rotate(${f(deg * 1.15)})"><path d="${sepal}" fill="url(#${gild})" stroke="${INK}" ` +
        `stroke-width="0.55"/></g>`
    );
  }
  return def(`<g id="{{id}}">${parts.join("")}</g>`);
}

const TAU_DEG = (i, n) => (360 / n) * i;

/**
 * Astrolabe boss: limb with graduations, an inner tropic circle, the alidade
 * across it and a pin at the centre. Reads as a gilded roundel at arm's length.
 */
function astrolabeDef({ r = 12 } = {}) {
  const gild = gildGradient();
  const mater = washGradient(PIGMENT.ultramarine, 40);
  const parts = [
    // gilded limb over a lapis mater, so the roundel reads even at margin size
    `<circle r="${f(r)}" fill="url(#${gild})" stroke="${INK}" stroke-width="0.9"/>`,
    `<circle r="${f(r * 0.72)}" fill="url(#${mater})" stroke="${INK}" stroke-width="0.7"/>`,
  ];
  // graduations on the limb, every 30 degrees, longer at the quadrants
  for (let i = 0; i < 12; i++) {
    const a = rad(i * 30);
    const long = i % 3 === 0;
    const r0 = r * (long ? 0.74 : 0.84);
    parts.push(
      `<path d="M${f(Math.cos(a) * r0)} ${f(Math.sin(a) * r0)} L${f(Math.cos(a) * r * 0.97)} ${f(
        Math.sin(a) * r * 0.97
      )}" stroke="${INK}" stroke-width="${long ? 0.9 : 0.6}" opacity="0.85"/>`
    );
  }
  // the tropic circle, the alidade across it, and the pin
  parts.push(
    `<circle r="${f(r * 0.4)}" fill="none" stroke="${GILD.light}" stroke-width="0.7" opacity="0.8"/>`,
    `<path d="M${f(-r * 0.66)} 0 L${f(r * 0.66)} 0" stroke="${GILD.light}" stroke-width="1.1"/>`,
    `<path d="M${f(r * 0.34)} ${f(-r * 0.22)} L${f(r * 0.66)} 0 L${f(r * 0.34)} ${f(
      r * 0.22
    )}" fill="none" stroke="${GILD.light}" stroke-width="0.8"/>`,
    `<circle r="${f(r * 0.15)}" fill="${GILD.light}" stroke="${INK}" stroke-width="0.5"/>`
  );
  return def(`<g id="{{id}}">${parts.join("")}</g>`);
}

/**
 * Double-helix tendril: two gilded strands wound about a curving axis, with
 * base pairs between them. A twist of vine until you look twice.
 */
function helixDef({ len = 58, amp = 8.2, turns = 1.6, pairs = 8, bend = 14 } = {}) {
  const gild = gildGradient();
  const axis = (t) => [bend * t * t, -len * t];
  const strand = (phase) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const [ax, ay] = axis(t);
      pts.push([ax + amp * Math.sin(TAU * turns * t + phase), ay]);
    }
    return pts;
  };
  const parts = [];
  // base pairs first, so the strands read as passing over them
  for (let k = 1; k <= pairs; k++) {
    const t = k / (pairs + 1);
    const [ax, ay] = axis(t);
    const x1 = ax + amp * Math.sin(TAU * turns * t);
    const x2 = ax + amp * Math.sin(TAU * turns * t + Math.PI);
    parts.push(
      `<path d="M${f(x1)} ${f(ay)} L${f(x2)} ${f(ay)}" stroke="${GILD.deep}" stroke-width="1.3" opacity="0.85"/>`
    );
  }
  for (const phase of [0, Math.PI]) {
    parts.push(
      `<path d="${spline(ribbon(strand(phase), 3.2, 1.6))}" fill="url(#${gild})" ` +
        `stroke="${INK}" stroke-width="0.55"/>`
    );
  }
  // a small bud where the helix leaves the stem
  parts.push(`<circle r="1.9" fill="${GILD.light}" stroke="${INK}" stroke-width="0.5"/>`);
  return def(`<g id="{{id}}">${parts.join("")}</g>`);
}

const TAU = Math.PI * 2;

function budDef(p) {
  const wash = washGradient(p, 10);
  const gild = gildGradient();
  const sepal = spline(petal({ len: 18, wide: 7, power: 0.72, taper: 0.18, curve: 1.2 }));
  const core = spline(petal({ len: 14.5, wide: 4.8, power: 0.78, taper: 0.2 }));
  const calyx = spline(serratedLeaf({ len: 10, wide: 4.6, teeth: 3, tooth: 0.7, curve: 0, n: 20 }));
  return def(
    `<g id="{{id}}">` +
      `<g transform="rotate(-17)"><path d="${sepal}" fill="url(#${wash})" stroke="${INK}" stroke-width="0.75"/></g>` +
      `<g transform="rotate(16)"><path d="${sepal}" fill="url(#${wash})" stroke="${INK}" stroke-width="0.75"/></g>` +
      `<path d="${core}" fill="${p.mid}" stroke="${INK}" stroke-width="0.65"/>` +
      `<path d="${core}" fill="none" stroke="${WHITE}" stroke-width="0.6" opacity="0.35" transform="translate(0.8 0)"/>` +
      `<path d="${calyx}" fill="url(#${gild})" stroke="${GILD.tool}" stroke-width="0.55"/>` +
      `</g>`
  );
}

/** a bezant: the gold dot with a white eye that fills manuscript margins */
function bezantDef() {
  const gild = gildGradient();
  return def(
    `<g id="{{id}}">` +
      `<circle r="2.6" fill="url(#${gild})" stroke="${INK}" stroke-width="0.5"/>` +
      `<circle cx="-0.7" cy="-0.7" r="0.85" fill="${WHITE}" opacity="0.75"/>` +
      `</g>`
  );
}

function serratedLeafDef(p) {
  const wash = washGradient(p, 34);
  const geom = { len: 34, wide: 7.4, teeth: 9, tooth: 1.5, curve: 11 };
  const d = spline(serratedLeaf(geom));
  const mid = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    mid.push([geom.curve * t * t, -geom.len * t]);
  }
  const veins = [];
  for (let k = 1; k <= 4; k++) {
    const t = 0.16 + k * 0.16;
    const i = Math.round(t * 10);
    const w = geom.wide * Math.pow(Math.sin(Math.PI * t), 0.6) * 0.8;
    for (const side of [1, -1]) {
      veins.push(
        `<path d="M${f(mid[i][0])} ${f(mid[i][1])} Q${f(mid[i][0] + w * 0.5 * side)} ${f(
          mid[i][1] - 2
        )} ${f(mid[i][0] + w * side)} ${f(mid[i][1] - 4.2)}" fill="none"/>`
      );
    }
  }
  return def(
    `<g id="{{id}}">` +
      `<path d="${d}" fill="url(#${wash})" stroke="${INK}" stroke-width="0.72"/>` +
      `<g stroke="${INK}" stroke-width="0.45" opacity="0.45">${veins.join("")}</g>` +
      `<path d="${spline(mid.slice(0, 10), false)}" fill="none" stroke="${INK}" stroke-width="0.6" opacity="0.55"/>` +
      `<path d="${spline(mid.slice(1, 9), false)}" fill="none" stroke="${WHITE}" stroke-width="0.6" ` +
      `opacity="0.3" transform="translate(0.8 0)"/>` +
      `<path d="${d}" fill="none" stroke="${GILD.mid}" stroke-width="0.45" opacity="0.5"/>` +
      `</g>`
  );
}

function tendrilDef(flip) {
  const gild = gildGradient();
  const spiral = logSpiral({ a: 1.15, b: 0.44, to: 6.5, flip }).reverse();
  // shift the spiral so its thick outer end sits at the origin, which is where
  // the tendril meets the stem; it then curls inward to a fine point
  const [ox, oy] = spiral[0];
  const pts = spiral.map(([x, y]) => [x - ox, y - oy]);
  return def(
    `<g id="{{id}}"><path d="${spline(ribbon(pts, 3.6, 0.4))}" fill="url(#${gild})" ` +
      `stroke="${INK}" stroke-width="0.5"/></g>`
  );
}

/* ------------------------------------------------------------ the margins */

/* The stem keeps a gentle serpentine. It used to swing nearly the full width,
   which left no room for the acanthus without clipping the tile. */
const S1 = [
  [70, 0],
  [98, 100],
  [42, 180],
  [70, 280],
];
const S2 = [
  [70, 280],
  [98, 380],
  [42, 460],
  [70, TILE_H],
];

const stemAt = (u) => (u <= 1 ? bez(...S1, u) : bez(...S2, u - 1));
const stemTan = (u) => (u <= 1 ? bezTan(...S1, u) : bezTan(...S2, u - 1));

/**
 * Rotation, in degrees, that aims an upward-growing form off the stem: blend 0
 * points straight out along the normal, blend 1 folds it back along the stem
 * toward the head. Leaves swept up-stem stay inside the tile and read as
 * scrollwork rather than as spokes.
 */
function aim(u, side, blend = 0) {
  const [tx, ty] = stemTan(u);
  const dx = -ty * side * (1 - blend) + -tx * blend;
  const dy = tx * side * (1 - blend) + -ty * blend;
  const m = Math.hypot(dx, dy) || 1;
  return (Math.atan2(dx / m, -dy / m) * 180) / Math.PI;
}

/** a gilded stem: ink bed, gold body, burnished highlight */
function stem(d, w = 5) {
  return (
    `<g fill="none" stroke-linecap="round">` +
    `<path d="${d}" stroke="${INK}" stroke-width="${f(w)}"/>` +
    `<path d="${d}" stroke="${GILD.mid}" stroke-width="${f(w * 0.64)}"/>` +
    `<path d="${d}" stroke="${GILD.light}" stroke-width="${f(w * 0.2)}" opacity="0.75"/>` +
    `</g>`
  );
}

function paintedPage(viewBox, w, h, body, seed) {
  /* The art is drawn once, then again through a mask as a pigment wash, so the
     colour sits unevenly the way tempera does on vellum. The displacement
     filter takes every edge slightly off true. */
  const art =
    `<g id="art" filter="url(#hand)">\n` + body.join("\n") + `\n</g>`;
  const filters =
    `<filter id="hand" x="-12%" y="-6%" width="124%" height="112%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${seed}" result="warp"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="warp" scale="1.5" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>` +
    `<filter id="pigment" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.19 0.24" numOctaves="4" seed="${seed + 5}"/>` +
    `<feColorMatrix type="saturate" values="0.06"/>` +
    `</filter>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}">\n` +
    `<!-- Generated by tools/build-ornament.mjs. Edit the generator, not this file. -->\n` +
    `<defs>${filters}${defs.join("")}\n${art}\n` +
    `<mask id="pigmentMask" style="mask-type:alpha">${use("art")}</mask>` +
    `</defs>\n` +
    use("art") +
    `\n<g mask="url(#pigmentMask)" style="mix-blend-mode:multiply" opacity="0.36">` +
    `<rect width="${w}" height="${h}" filter="url(#pigment)"/></g>\n` +
    `</svg>\n`
  );
}

function buildVine() {
  resetDefs();

  const leafBlue = acanthusDef(PIGMENT.ultramarine, { len: 50, wide: 19 });
  const leafGold = acanthusDef(PIGMENT.gold, { len: 47, wide: 18 });
  const leafGreen = acanthusDef(PIGMENT.verdigris, { len: 48, wide: 18 });
  const leafOlive = acanthusDef(PIGMENT.terreverte, { len: 42, wide: 16, lobes: 4 });
  const sprigGreen = serratedLeafDef(PIGMENT.verdigris);
  const sprigOlive = serratedLeafDef(PIGMENT.terreverte);

  const blossomVermilion = bloomDef(PIGMENT.vermilion, { outer: 6, inner: 5 });
  const blossomMadder = bloomDef(PIGMENT.madder, { outer: 5, inner: 5, len: 25, wide: 10.5 });
  const blossomBlue = bloomDef(PIGMENT.ultramarine, { outer: 6, inner: 0, courses: 1, len: 24 });
  const pomegranate = seedHeadDef(PIGMENT.madder);
  const astrolabe = astrolabeDef({ r: 12 });
  const astrolabeSmall = astrolabeDef({ r: 8.4 });
  const helixR = helixDef({ bend: 9 });
  const helixL = helixDef({ bend: 9, turns: 1.75 });
  const budVermilion = budDef(PIGMENT.vermilion);
  const budBlue = budDef(PIGMENT.azurite);
  const bezant = bezantDef();
  const curlR = tendrilDef(1);
  const curlL = tendrilDef(-1);

  const stemD =
    `M${f(S1[0][0])} ${f(S1[0][1])}` +
    ` C${f(S1[1][0])} ${f(S1[1][1])} ${f(S1[2][0])} ${f(S1[2][1])} ${f(S1[3][0])} ${f(S1[3][1])}` +
    ` C${f(S2[1][0])} ${f(S2[1][1])} ${f(S2[2][0])} ${f(S2[2][1])} ${f(S2[3][0])} ${f(S2[3][1])}`;

  const body = [stem(stemD)];
  const at = (id, x, y, rot, scale, flip = 1) =>
    `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(scale * flip)} ${f(
      scale
    )})">${use(id)}</g>`;

  // shoots that carry the blooms
  const shoots = [
    { u: 0.26, side: 1, to: [104, 76] },
    { u: 0.72, side: -1, to: [36, 208] },
    { u: 1.24, side: 1, to: [102, 352] },
    { u: 1.72, side: -1, to: [38, 486] },
  ];
  for (const s of shoots) {
    const p = stemAt(s.u);
    const [tx, ty] = stemTan(s.u);
    const c1 = [p[0] - ty * 18 * s.side, p[1] + tx * 18 * s.side];
    const c2 = [(c1[0] + s.to[0]) / 2, s.to[1] + (p[1] < s.to[1] ? -14 : 14)];
    body.push(
      stem(
        `M${f(p[0])} ${f(p[1])} C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(s.to[0])} ${f(
          s.to[1]
        )}`,
        3.4
      )
    );
  }

  // acanthus scrollwork, the frame of the margin
  const scrolls = [
    { u: 0.14, side: -1, id: leafBlue, s: 0.92 },
    { u: 0.34, side: 1, id: leafGold, s: 1 },
    { u: 0.54, side: -1, id: leafGreen, s: 0.96 },
    { u: 0.7, side: 1, id: leafOlive, s: 0.86 },
    { u: 0.86, side: -1, id: leafGold, s: 0.94 },
    { u: 1.04, side: 1, id: leafBlue, s: 1 },
    { u: 1.24, side: -1, id: leafOlive, s: 0.88 },
    { u: 1.42, side: 1, id: leafGreen, s: 0.96 },
    { u: 1.6, side: -1, id: leafGold, s: 0.94 },
    { u: 1.86, side: 1, id: leafBlue, s: 0.9 },
  ];
  for (const s of scrolls) {
    const p = stemAt(s.u);
    body.push(at(s.id, p[0], p[1], aim(s.u, s.side, 0.24), s.s, s.side));
  }

  // lesser foliage
  const sprigs = [
    { u: 0.06, side: 1, id: sprigGreen, s: 0.78 },
    { u: 0.44, side: 1, id: sprigOlive, s: 0.74 },
    { u: 0.96, side: -1, id: sprigGreen, s: 0.78 },
    { u: 1.16, side: 1, id: sprigOlive, s: 0.72 },
    { u: 1.74, side: -1, id: sprigGreen, s: 0.76 },
  ];
  for (const s of sprigs) {
    const p = stemAt(s.u);
    body.push(at(s.id, p[0], p[1], aim(s.u, s.side, 0.3), s.s, s.side));
  }

  // gilded tendrils and the two helices
  body.push(at(curlR, ...stemAt(0.42), aim(0.42, 1, 0.5) - 90, 0.86));
  body.push(at(curlL, ...stemAt(0.6), aim(0.6, -1, 0.5) - 90, 0.9));
  body.push(at(curlR, ...stemAt(1.44), aim(1.44, 1, 0.5) - 90, 0.88));
  body.push(at(curlL, ...stemAt(1.66), aim(1.66, -1, 0.5) - 90, 0.84));

  body.push(at(helixR, ...stemAt(0.92), aim(0.92, 1, 0.42), 0.9));
  body.push(at(helixL, ...stemAt(1.9), aim(1.9, -1, 0.42), 0.86, -1));

  // blooms, seed head, bosses, buds
  body.push(at(blossomVermilion, 104, 76, -16, 1));
  body.push(at(astrolabe, ...stemAt(0.5), 12, 1));
  body.push(at(blossomMadder, 36, 208, 16, 0.94));
  body.push(at(budVermilion, stemAt(1.1)[0] + 6, stemAt(1.1)[1], 24, 0.95));
  body.push(at(pomegranate, 102, 352, -10, 0.92));
  body.push(at(astrolabeSmall, ...stemAt(1.5), -14, 1));
  body.push(at(blossomBlue, 38, 486, 12, 0.95));
  body.push(at(budBlue, stemAt(0.7)[0] - 6, stemAt(0.7)[1] + 8, -152, 0.8));

  // bezants scattered through the margin, as gold dots always are
  const r = rng(0x2f19);
  for (const u of [0.1, 0.3, 0.62, 0.8, 1.12, 1.3, 1.6, 1.82, 1.98]) {
    const p = stemAt(u);
    const side = r() > 0.5 ? 1 : -1;
    const [tx, ty] = stemTan(u);
    const off = 14 + r() * 10;
    const x = Math.min(130, Math.max(10, p[0] - ty * off * side));
    body.push(at(bezant, x, p[1] + tx * off * side, 0, 0.8 + r() * 0.4));
  }

  return paintedPage(`0 0 ${TILE_W} ${TILE_H}`, TILE_W, TILE_H, body, 9);
}

function buildTip() {
  resetDefs();
  const leafBlue = acanthusDef(PIGMENT.ultramarine, { len: 40, wide: 14, lobes: 3 });
  const leafGreen = acanthusDef(PIGMENT.verdigris, { len: 36, wide: 12.5, lobes: 3 });
  const sprigGreen = serratedLeafDef(PIGMENT.verdigris);
  const blossom = bloomDef(PIGMENT.vermilion, { outer: 6, inner: 5 });
  const bezant = bezantDef();
  const curlR = tendrilDef(1);
  const curlL = tendrilDef(-1);

  const at = (id, x, y, rot, scale, flip = 1) =>
    `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(scale * flip)} ${f(
      scale
    )})">${use(id)}</g>`;

  // leaves the bottom edge on the tangent the tile enters on, so the join with
  // the repeating vine reads as one continuous stem
  const body = [stem("M70 150 C61 124 78 100 70 62")];
  body.push(at(leafBlue, 74, 132, -66, 0.95));
  body.push(at(leafGreen, 64, 112, 66, 0.9, -1));
  body.push(at(sprigGreen, 72, 96, -50, 0.76));
  body.push(at(curlR, 78, 140, -22, 0.88));
  body.push(at(curlL, 62, 122, 200, 0.8));
  body.push(at(blossom, 70, 54, 0, 1));
  body.push(at(bezant, 92, 116, 0, 0.9));
  body.push(at(bezant, 48, 132, 0, 0.8));
  body.push(at(bezant, 88, 146, 0, 0.7));

  return paintedPage(`0 0 ${TILE_W} 150`, TILE_W, 150, body, 21);
}

/**
 * `--proof <file>` lays every component out large on one sheet, which is the
 * only practical way to judge a form that ends up 30 pixels tall in the margin.
 */
function buildProof() {
  resetDefs();
  const specimens = [
    acanthusDef(PIGMENT.ultramarine, { len: 50, wide: 19 }),
    acanthusDef(PIGMENT.gold, { len: 47, wide: 18 }),
    acanthusDef(PIGMENT.verdigris, { len: 43, wide: 16, lobes: 4 }),
    serratedLeafDef(PIGMENT.terreverte),
    bloomDef(PIGMENT.vermilion, { outer: 6, inner: 5 }),
    bloomDef(PIGMENT.madder, { outer: 5, inner: 5, len: 25, wide: 10.5 }),
    bloomDef(PIGMENT.ultramarine, { outer: 6, inner: 0, courses: 1, len: 24 }),
    seedHeadDef(PIGMENT.madder),
    astrolabeDef({ r: 12 }),
    helixDef({}),
    budDef(PIGMENT.vermilion),
    bezantDef(),
  ];
  const cols = 4;
  const cell = 150;
  const body = specimens.map((id, i) => {
    const x = (i % cols) * cell + cell / 2;
    const y = Math.floor(i / cols) * cell + cell * 0.72;
    return `<g transform="translate(${x} ${y}) scale(1.5)">${use(id)}</g>`;
  });
  const h = Math.ceil(specimens.length / cols) * cell;
  return paintedPage(`0 0 ${cols * cell} ${h}`, cols * cell, h, body, 9);
}

const proofArg = process.argv.indexOf("--proof");
if (proofArg !== -1) {
  const out = process.argv[proofArg + 1] || "/tmp/ornament-proof.svg";
  writeFileSync(out, buildProof());
  console.log(`proof -> ${out}`);
  process.exit(0);
}

mkdirSync(ASSETS, { recursive: true });
for (const [name, svg] of [
  ["vine.svg", buildVine()],
  ["vine-tip.svg", buildTip()],
]) {
  writeFileSync(resolve(ASSETS, name), svg);
  console.log(`${name.padEnd(14)} ${(svg.length / 1024).toFixed(1)} KB`);
}
