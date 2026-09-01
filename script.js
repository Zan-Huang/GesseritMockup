const field = document.getElementById("field");
const fieldCtx = field.getContext("2d", { alpha: true });
const illum = document.getElementById("illumination");
const illumCtx = illum.getContext("2d", { alpha: true });
const dropLetter = document.querySelector(".drop-letter");

const GRID = 28;
const REVEAL_RADIUS = 148;
const BLOOM_RADIUS = 136;
const BLOOM_DELAY = 780;
const SPRAWL_STAGGER = 1400;
const STEM_LEAD = 340;
const BLOOM_SPEED = 0.0028;
const FADE_SPEED = 0.0032;
const PERSIST_MS = 3200;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const PHI = (1 + Math.sqrt(5)) / 2;

const mouse = { x: -9999, y: -9999, inside: false };
const blooms = new Map();

function resizeCanvas(canvas, ctx) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resize() {
  resizeCanvas(field, fieldCtx);
  resizeCanvas(illum, illumCtx);
}

function hash(x, y) {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >>> 13)) * 1274126177;
  return (n ^ (n >>> 16)) >>> 0;
}

function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function noise3(x, y, z) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const tz = fade(z - z0);

  const n000 = hash(x0, y0 + z0 * 57) / 4294967295;
  const n100 = hash(x0 + 1, y0 + z0 * 57) / 4294967295;
  const n010 = hash(x0, y0 + 1 + z0 * 57) / 4294967295;
  const n110 = hash(x0 + 1, y0 + 1 + z0 * 57) / 4294967295;
  const n001 = hash(x0, y0 + (z0 + 1) * 57) / 4294967295;
  const n101 = hash(x0 + 1, y0 + (z0 + 1) * 57) / 4294967295;
  const n011 = hash(x0, y0 + 1 + (z0 + 1) * 57) / 4294967295;
  const n111 = hash(x0 + 1, y0 + 1 + (z0 + 1) * 57) / 4294967295;

  return lerp(
    lerp(lerp(n000, n100, tx), lerp(n010, n110, tx), ty),
    lerp(lerp(n001, n101, tx), lerp(n011, n111, tx), ty),
    tz,
  );
}

function curlNoise(x, y, t) {
  const e = 0.75;
  const n1 = noise3(x, y + e, t);
  const n2 = noise3(x, y - e, t);
  const n3 = noise3(x + e, y, t);
  const n4 = noise3(x - e, y, t);
  return {
    x: (n1 - n2) / (2 * e),
    y: (n4 - n3) / (2 * e),
  };
}

function flowAt(x, y, t, sx, sy, swirl) {
  const dx = x - sx;
  const dy = y - sy;
  const r2 = dx * dx + dy * dy + 12;
  const r = Math.sqrt(r2);
  const source = 26 / r2;
  const curl = curlNoise(x * 0.035, y * 0.035, t * 0.000045);
  return {
    x: dx * source + (-dy / r) * swirl + curl.x * 28,
    y: dy * source + (dx / r) * swirl + curl.y * 28 + 0.55,
  };
}

function integrateStream(sx, sy, seed, now, steps, dt) {
  const random = mulberry32(seed);
  const swirl = 0.35 + random() * 0.55;
  const spin = random() < 0.5 ? 1 : -1;
  const pts = [{ x: sx, y: sy }];
  let x = sx + (random() - 0.5) * 2;
  let y = sy + (random() - 0.5) * 2;

  for (let i = 0; i < steps; i += 1) {
    const v1 = flowAt(x, y, now, sx, sy, swirl * spin);
    const mx = x + v1.x * dt;
    const my = y + v1.y * dt;
    const v2 = flowAt(mx, my, now, sx, sy, swirl * spin);
    x += 0.5 * dt * (v1.x + v2.x);
    y += 0.5 * dt * (v1.y + v2.y);
    pts.push({ x, y });
  }
  return pts;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function easeOutBack(t) {
  const c1 = 1.2;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function falloff(distance, radius) {
  if (distance >= radius) return 0;
  const t = 1 - distance / radius;
  return t * t * (3 - 2 * t);
}

function setPointer(clientX, clientY, inside) {
  mouse.x = clientX;
  mouse.y = clientY;
  mouse.inside = inside;
}

window.addEventListener("pointermove", (event) => {
  setPointer(event.clientX, event.clientY, true);
});

window.addEventListener("pointerdown", (event) => {
  setPointer(event.clientX, event.clientY, true);
});

window.addEventListener("pointerleave", () => {
  mouse.inside = false;
});

window.addEventListener("blur", () => {
  mouse.inside = false;
});

window.addEventListener("resize", resize);

function gridOrigin(size, extent) {
  return ((extent / 2) % size) - size;
}

function pointOnPath(pts, t) {
  const scaled = Math.max(0, Math.min(1, t)) * (pts.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = pts[i];
  const b = pts[Math.min(i + 1, pts.length - 1)];
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
}

function tangentOnPath(pts, t) {
  const a = pointOnPath(pts, Math.max(0, t - 0.04));
  const b = pointOnPath(pts, Math.min(1, t + 0.04));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function drawGrid(ctx) {
  if (!mouse.inside) return;

  const width = window.innerWidth;
  const height = window.innerHeight;
  const originX = gridOrigin(GRID, width);
  const originY = gridOrigin(GRID, height);
  const mx = mouse.x;
  const my = mouse.y;
  const minX = mx - REVEAL_RADIUS;
  const maxX = mx + REVEAL_RADIUS;
  const minY = my - REVEAL_RADIUS;
  const maxY = my + REVEAL_RADIUS;

  ctx.save();
  ctx.beginPath();
  ctx.rect(minX, minY, REVEAL_RADIUS * 2, REVEAL_RADIUS * 2);
  ctx.clip();
  ctx.strokeStyle = "rgba(32, 38, 46, 0.42)";
  ctx.lineWidth = 0.65;

  for (let x = originX; x <= width + GRID; x += GRID) {
    if (x < minX || x > maxX) continue;
    ctx.beginPath();
    ctx.moveTo(x, minY);
    ctx.lineTo(x, maxY);
    ctx.stroke();
  }

  for (let y = originY; y <= height + GRID; y += GRID) {
    if (y < minY || y > maxY) continue;
    ctx.beginPath();
    ctx.moveTo(minX, y);
    ctx.lineTo(maxX, y);
    ctx.stroke();
  }

  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  const wash = ctx.createRadialGradient(mx, my, REVEAL_RADIUS * 0.2, mx, my, REVEAL_RADIUS);
  wash.addColorStop(0, "rgba(0, 0, 0, 1)");
  wash.addColorStop(0.62, "rgba(0, 0, 0, 0.5)");
  wash.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(minX, minY, REVEAL_RADIUS * 2, REVEAL_RADIUS * 2);
  ctx.restore();
}

function hsla(h, s, l, a) {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

function leafPalette(random) {
  const roll = random();
  const j = () => random();

  if (roll < 0.22) {
    const h = 148 + j() * 16;
    return {
      umber: hsla(h, 42 + j() * 10, 7 + j() * 4, 0.84),
      body: hsla(h + 2, 48 + j() * 10, 12 + j() * 5, 0.95),
      mid: hsla(h - 4, 36 + j() * 12, 20 + j() * 6, 0.9),
      light: hsla(95 + j() * 18, 26 + j() * 12, 32 + j() * 8, 0.58),
      gleam: hsla(46, 82, 64, 0.28 + j() * 0.12),
      vein: hsla(42, 50, 36, 0.4),
      gilt: hsla(44, 88, 56, 0.52),
    };
  }
  if (roll < 0.4) {
    const h = 88 + j() * 22;
    return {
      umber: hsla(h + 20, 28 + j() * 10, 12 + j() * 4, 0.8),
      body: hsla(h, 34 + j() * 14, 22 + j() * 6, 0.93),
      mid: hsla(h + 8, 38 + j() * 12, 32 + j() * 8, 0.9),
      light: hsla(72 + j() * 14, 40 + j() * 12, 44 + j() * 8, 0.62),
      gleam: hsla(50, 78, 68, 0.3),
      vein: hsla(95, 22, 24, 0.42),
      gilt: hsla(46, 80, 54, 0.48),
    };
  }
  if (roll < 0.55) {
    const h = 118 + j() * 18;
    return {
      umber: hsla(h, 30 + j() * 8, 14 + j() * 4, 0.8),
      body: hsla(h + 6, 22 + j() * 10, 26 + j() * 6, 0.92),
      mid: hsla(h - 8, 18 + j() * 10, 36 + j() * 8, 0.88),
      light: hsla(70 + j() * 12, 24 + j() * 10, 48 + j() * 8, 0.55),
      gleam: hsla(48, 70, 70, 0.26),
      vein: hsla(40, 35, 32, 0.38),
      gilt: hsla(43, 75, 52, 0.45),
    };
  }
  if (roll < 0.72) {
    const h = 38 + j() * 8;
    return {
      umber: hsla(h - 6, 58 + j() * 10, 16 + j() * 4, 0.8),
      body: hsla(h, 84 + j() * 10, 34 + j() * 6, 0.95),
      mid: hsla(h + 5, 90 + j() * 8, 48 + j() * 6, 0.92),
      light: hsla(h + 10, 96, 66 + j() * 8, 0.74),
      gleam: hsla(48, 100, 84, 0.58),
      vein: hsla(30, 48, 22, 0.42),
      gilt: hsla(45, 100, 72, 0.72),
    };
  }
  if (roll < 0.84) {
    const h = 44 + j() * 8;
    return {
      umber: hsla(36, 48, 20, 0.78),
      body: hsla(h, 62 + j() * 12, 52 + j() * 8, 0.9),
      mid: hsla(h + 6, 70 + j() * 12, 64 + j() * 8, 0.88),
      light: hsla(50, 80, 78 + j() * 8, 0.7),
      gleam: hsla(52, 100, 90, 0.5),
      vein: hsla(38, 40, 28, 0.38),
      gilt: hsla(48, 95, 78, 0.65),
    };
  }
  if (roll < 0.92) {
    const h = 28 + j() * 14;
    return {
      umber: hsla(20, 55, 14, 0.82),
      body: hsla(h, 72 + j() * 12, 32 + j() * 6, 0.94),
      mid: hsla(h + 8, 78 + j() * 10, 44 + j() * 8, 0.9),
      light: hsla(40 + j() * 8, 82, 56 + j() * 8, 0.7),
      gleam: hsla(46, 90, 70, 0.42),
      vein: hsla(18, 45, 22, 0.42),
      gilt: hsla(38, 85, 52, 0.55),
    };
  }
  const h = random() < 0.5 ? 8 + j() * 12 : 352 + j() * 10;
  return {
    umber: hsla(8, 48, 12, 0.82),
    body: hsla(h, 58 + j() * 14, 28 + j() * 6, 0.93),
    mid: hsla(h + 6, 62 + j() * 12, 40 + j() * 8, 0.88),
    light: hsla(28 + j() * 10, 70, 52 + j() * 8, 0.62),
    gleam: hsla(42, 80, 64, 0.35),
    vein: hsla(12, 40, 20, 0.4),
    gilt: hsla(36, 78, 48, 0.5),
  };
}

function profilePath(ctx, length, widthAt, samples = 36) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    ctx.lineTo(widthAt(t), -length * t);
  }
  for (let i = samples - 1; i >= 1; i -= 1) {
    const t = i / samples;
    ctx.lineTo(-widthAt(t), -length * t);
  }
  ctx.closePath();
}

function ellipticWidth(t, width) {
  return width * Math.sin(Math.PI * Math.max(0, Math.min(1, t)));
}

function ovateWidth(t, width) {
  const peak = 0.36;
  const u = t <= peak ? t / peak : (1 - t) / (1 - peak);
  return width * Math.sin((Math.PI * 0.5) * Math.max(0, Math.min(1, u)));
}

function lanceWidth(t, width) {
  return width * Math.pow(Math.sin(Math.PI * Math.max(0, Math.min(1, t))), 1.45);
}

function bayPath(ctx, length, width) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(width * 0.12, -length * 0.03, width * 0.98, -length * 0.24, width, -length * 0.5);
  ctx.bezierCurveTo(width * 0.9, -length * 0.78, width * 0.26, -length * 0.97, 0, -length);
  ctx.bezierCurveTo(-width * 0.26, -length * 0.97, -width * 0.9, -length * 0.78, -width, -length * 0.5);
  ctx.bezierCurveTo(-width * 0.98, -length * 0.24, -width * 0.12, -length * 0.03, 0, 0);
  ctx.closePath();
}

function olivePath(ctx, length, width) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(width * 0.2, -length * 0.04, width * 0.92, -length * 0.28, width * 0.88, -length * 0.55);
  ctx.bezierCurveTo(width * 0.72, -length * 0.86, width * 0.22, -length * 0.98, 0, -length * 0.99);
  ctx.bezierCurveTo(-width * 0.22, -length * 0.98, -width * 0.72, -length * 0.86, -width * 0.88, -length * 0.55);
  ctx.bezierCurveTo(-width * 0.92, -length * 0.28, -width * 0.2, -length * 0.04, 0, 0);
  ctx.closePath();
}

function oakPath(ctx, length, width) {
  const right = [
    [0, 0],
    [width * 0.28, -length * 0.05],
    [width * 0.5, -length * 0.15],
    [width * 0.24, -length * 0.23],
    [width * 0.74, -length * 0.36],
    [width * 0.34, -length * 0.46],
    [width * 0.98, -length * 0.58],
    [width * 0.4, -length * 0.68],
    [width * 0.72, -length * 0.8],
    [width * 0.26, -length * 0.88],
    [0, -length],
  ];
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 1; i < right.length; i += 1) {
    const prev = right[i - 1];
    const curr = right[i];
    const mx = (prev[0] + curr[0]) * 0.5;
    const my = (prev[1] + curr[1]) * 0.5;
    ctx.quadraticCurveTo(curr[0] * 0.35 + prev[0] * 0.65, (prev[1] + curr[1]) * 0.5, mx, my);
    ctx.quadraticCurveTo(curr[0], curr[1], curr[0], curr[1]);
  }
  for (let i = right.length - 2; i >= 0; i -= 1) {
    ctx.quadraticCurveTo(-right[i][0] * 0.85, right[i][1] + length * 0.01, -right[i][0], right[i][1]);
  }
  ctx.closePath();
}

function hollyPath(ctx, length, width) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  const spines = 8;
  for (let side of [1, -1]) {
    if (side === -1) ctx.lineTo(0, -length);
    const dir = side === 1 ? 1 : -1;
    const start = side === 1 ? 0 : spines - 1;
    const end = side === 1 ? spines : -1;
    for (let i = start; i !== end; i += dir) {
      const tValley = (i + 0.18) / spines;
      const tTip = (i + 0.52) / spines;
      const tNext = (i + 0.82) / spines;
      ctx.lineTo(side * ovateWidth(tValley, width) * 0.68, -length * tValley);
      ctx.lineTo(side * ovateWidth(tTip, width) * 1.2, -length * tTip);
      ctx.lineTo(side * ovateWidth(Math.min(0.98, tNext), width) * 0.66, -length * Math.min(0.98, tNext));
    }
  }
  ctx.closePath();
}

function willowPath(ctx, length, width) {
  profilePath(ctx, length, (t) => {
    const body = lanceWidth(t, width);
    const tooth = 1 + 0.07 * Math.sin(t * Math.PI * 22);
    return body * tooth;
  }, 56);
}

function ivyPath(ctx, size) {
  ctx.beginPath();
  ctx.moveTo(0, size * 0.05);
  ctx.bezierCurveTo(size * 0.4, size * 0.18, size * 0.78, size * 0.02, size * 0.9, -size * 0.24);
  ctx.lineTo(size * 0.96, -size * 0.38);
  ctx.quadraticCurveTo(size * 0.42, -size * 0.36, size * 0.3, -size * 0.5);
  ctx.bezierCurveTo(size * 0.2, -size * 0.74, size * 0.05, -size * 0.95, 0, -size);
  ctx.bezierCurveTo(-size * 0.05, -size * 0.95, -size * 0.2, -size * 0.74, -size * 0.3, -size * 0.5);
  ctx.quadraticCurveTo(-size * 0.42, -size * 0.36, -size * 0.96, -size * 0.38);
  ctx.lineTo(-size * 0.9, -size * 0.24);
  ctx.bezierCurveTo(-size * 0.78, size * 0.02, -size * 0.4, size * 0.18, 0, size * 0.05);
  ctx.closePath();
}

function maplePath(ctx, size) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(size * 0.16, size * 0.02, size * 0.5, -size * 0.02, size * 0.7, -size * 0.16);
  ctx.lineTo(size * 0.46, -size * 0.22);
  ctx.quadraticCurveTo(size * 0.4, -size * 0.3, size * 0.48, -size * 0.34);
  ctx.bezierCurveTo(size * 0.82, -size * 0.36, size * 0.98, -size * 0.46, size * 0.86, -size * 0.58);
  ctx.quadraticCurveTo(size * 0.48, -size * 0.52, size * 0.3, -size * 0.6);
  ctx.bezierCurveTo(size * 0.26, -size * 0.8, size * 0.08, -size * 0.96, 0, -size);
  ctx.bezierCurveTo(-size * 0.08, -size * 0.96, -size * 0.26, -size * 0.8, -size * 0.3, -size * 0.6);
  ctx.quadraticCurveTo(-size * 0.48, -size * 0.52, -size * 0.86, -size * 0.58);
  ctx.bezierCurveTo(-size * 0.98, -size * 0.46, -size * 0.82, -size * 0.36, -size * 0.48, -size * 0.34);
  ctx.quadraticCurveTo(-size * 0.4, -size * 0.3, -size * 0.46, -size * 0.22);
  ctx.lineTo(-size * 0.7, -size * 0.16);
  ctx.bezierCurveTo(-size * 0.5, -size * 0.02, -size * 0.16, size * 0.02, 0, 0);
  ctx.closePath();
}

function figPath(ctx, size) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(size * 0.28, -size * 0.01, size * 0.82, -size * 0.08, size * 0.86, -size * 0.36);
  ctx.quadraticCurveTo(size * 0.32, -size * 0.38, size * 0.24, -size * 0.48);
  ctx.bezierCurveTo(size * 0.42, -size * 0.7, size * 0.14, -size * 0.94, 0, -size);
  ctx.bezierCurveTo(-size * 0.14, -size * 0.94, -size * 0.42, -size * 0.7, -size * 0.24, -size * 0.48);
  ctx.quadraticCurveTo(-size * 0.32, -size * 0.38, -size * 0.86, -size * 0.36);
  ctx.bezierCurveTo(-size * 0.82, -size * 0.08, -size * 0.28, -size * 0.01, 0, 0);
  ctx.closePath();
}

function hawthornPath(ctx, size) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size * 0.12, -size * 0.14);
  ctx.bezierCurveTo(size * 0.42, -size * 0.16, size * 0.7, -size * 0.18, size * 0.68, -size * 0.3);
  ctx.quadraticCurveTo(size * 0.3, -size * 0.36, size * 0.22, -size * 0.46);
  ctx.bezierCurveTo(size * 0.5, -size * 0.5, size * 0.58, -size * 0.62, size * 0.36, -size * 0.7);
  ctx.quadraticCurveTo(size * 0.12, -size * 0.78, 0, -size);
  ctx.quadraticCurveTo(-size * 0.1, -size * 0.76, -size * 0.18, -size * 0.64);
  ctx.bezierCurveTo(-size * 0.42, -size * 0.66, -size * 0.5, -size * 0.52, -size * 0.22, -size * 0.46);
  ctx.quadraticCurveTo(-size * 0.28, -size * 0.34, -size * 0.64, -size * 0.28);
  ctx.bezierCurveTo(-size * 0.4, -size * 0.16, -size * 0.12, -size * 0.12, 0, 0);
  ctx.closePath();
}

function ginkgoPath(ctx, radius) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-radius * 0.12, -radius * 0.22, -radius * 1.12, -radius * 0.32, -radius * 1.05, -radius * 0.78);
  ctx.quadraticCurveTo(-radius * 0.58, -radius * 1.12, -radius * 0.12, -radius * 0.84);
  ctx.lineTo(0, -radius * 0.68);
  ctx.lineTo(radius * 0.12, -radius * 0.84);
  ctx.quadraticCurveTo(radius * 0.58, -radius * 1.12, radius * 1.05, -radius * 0.78);
  ctx.bezierCurveTo(radius * 1.12, -radius * 0.32, radius * 0.12, -radius * 0.22, 0, 0);
  ctx.closePath();
}

function paintReticulum(ctx, length, width, colors) {
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = colors.vein;
  ctx.lineWidth = 0.18;
  const step = Math.max(2.4, length / 11);
  for (let y = -length * 0.08; y > -length; y -= step) {
    ctx.beginPath();
    ctx.moveTo(-width, y);
    ctx.lineTo(width, y - step * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(width, y);
    ctx.lineTo(-width, y - step * 0.55);
    ctx.stroke();
  }
  ctx.restore();
}

function paintPinnateVeins(ctx, length, width, colors, style) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(width * 0.02, -length * 0.5, 0, -length * 0.94);
  ctx.strokeStyle = colors.vein;
  ctx.lineWidth = 0.85;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(width * 0.035, -length * 0.03);
  ctx.quadraticCurveTo(width * 0.06, -length * 0.48, width * 0.015, -length * 0.9);
  ctx.strokeStyle = colors.gilt;
  ctx.lineWidth = 0.28;
  ctx.globalAlpha = 0.28;
  ctx.stroke();

  const count = style === "crasp" ? 8 : 7;
  for (let i = 1; i <= count; i += 1) {
    const t = 0.1 + (i / (count + 1)) * 0.78;
    const y = -length * t;
    const reach = width * (0.82 - t * 0.22);
    const lift = style === "crasp" ? 0.02 : 0.09;
    for (const side of [-1, 1]) {
      ctx.globalAlpha = 0.36;
      ctx.strokeStyle = colors.vein;
      ctx.lineWidth = 0.32;
      ctx.beginPath();
      ctx.moveTo(0, y);
      if (style === "crasp") {
        ctx.quadraticCurveTo(side * reach * 0.55, y - length * 0.03, side * reach, y - length * lift);
      } else {
        ctx.bezierCurveTo(
          side * reach * 0.45,
          y - length * 0.01,
          side * reach * 0.85,
          y - length * 0.04,
          side * reach * 0.55,
          y - length * 0.1,
        );
      }
      ctx.stroke();
    }
  }
}

function paintPalmateVeins(ctx, length, colors) {
  const rays = [-1.22, -0.88, -Math.PI / 2, -2.26, -1.92];
  rays.forEach((angle, index) => {
    const reach = index === 2 ? length * 0.92 : length * 0.78;
    ctx.globalAlpha = 0.48;
    ctx.strokeStyle = colors.vein;
    ctx.lineWidth = index === 2 ? 0.8 : 0.55;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
    ctx.stroke();
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 0.26;
    for (const side of [-0.32, 0.32]) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * reach * 0.35, Math.sin(angle) * reach * 0.35);
      ctx.quadraticCurveTo(
        Math.cos(angle + side) * reach * 0.55,
        Math.sin(angle + side) * reach * 0.55,
        Math.cos(angle + side * 0.7) * reach * 0.72,
        Math.sin(angle + side * 0.7) * reach * 0.72,
      );
      ctx.stroke();
    }
  });
}

function paintDichotomousVeins(ctx, length, width, colors) {
  function fork(x, y, angle, span, depth) {
    const x2 = x + Math.cos(angle) * span;
    const y2 = y + Math.sin(angle) * span;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (depth <= 0 || span < 2.2) return;
    fork(x2, y2, angle - 0.2, span * 0.68, depth - 1);
    fork(x2, y2, angle + 0.2, span * 0.68, depth - 1);
  }
  ctx.strokeStyle = colors.vein;
  ctx.lineWidth = 0.32;
  ctx.globalAlpha = 0.4;
  for (let i = -3; i <= 3; i += 1) {
    fork(0, 0, -Math.PI / 2 + i * 0.22, length * 0.34, 2);
  }
}

function paintModeledLeaf(ctx, pathFn, colors, length, width, vein = "pinnate") {
  ctx.save();
  pathFn();
  ctx.fillStyle = colors.umber;
  ctx.fill();

  ctx.save();
  pathFn();
  ctx.clip();
  const shade = ctx.createLinearGradient(-width, 0, width * 0.65, -length);
  shade.addColorStop(0, colors.umber);
  shade.addColorStop(0.3, colors.body);
  shade.addColorStop(0.62, colors.mid);
  shade.addColorStop(1, colors.light);
  ctx.fillStyle = shade;
  ctx.fill();

  const lamp = ctx.createRadialGradient(-width * 0.18, -length * 0.3, length * 0.05, 0, -length * 0.42, length * 0.9);
  lamp.addColorStop(0, colors.gleam);
  lamp.addColorStop(0.5, "hsla(45, 80%, 70%, 0)");
  ctx.fillStyle = lamp;
  ctx.fill();

  paintReticulum(ctx, length, width, colors);
  if (vein === "fan") paintDichotomousVeins(ctx, length, width, colors);
  else if (vein === "palmate") paintPalmateVeins(ctx, length, colors);
  else paintPinnateVeins(ctx, length, width, colors, vein === "crasp" ? "crasp" : "broch");
  ctx.restore();

  pathFn();
  ctx.strokeStyle = colors.gilt;
  ctx.lineWidth = 0.55;
  ctx.stroke();
  ctx.restore();
}

function tilt(ctx, random, amount = 0.1) {
  ctx.rotate((random() - 0.5) * amount);
}

function drawBay(ctx, open, random) {
  const length = (18.5 + random() * 2.2) * open;
  const width = length * 0.34;
  const colors = leafPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => bayPath(ctx, length, width), colors, length, width);
  ctx.restore();
}

function drawOlive(ctx, open, random) {
  const length = (17 + random() * 2) * open;
  const width = length * 0.2;
  const colors = leafPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => olivePath(ctx, length, width), colors, length, width);
  ctx.restore();
}

function drawWillow(ctx, open, random) {
  const length = (22 + random() * 3) * open;
  const width = length * 0.145;
  const colors = leafPalette(random);
  ctx.save();
  tilt(ctx, random, 0.16);
  paintModeledLeaf(ctx, () => willowPath(ctx, length, width), colors, length, width, "crasp");
  ctx.restore();
}

function drawOak(ctx, open, random) {
  const length = (19 + random() * 2.4) * open;
  const width = length * 0.46;
  const colors = leafPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => oakPath(ctx, length, width), colors, length, width, "crasp");
  ctx.restore();
}

function drawHolly(ctx, open, random) {
  const length = (17.5 + random() * 2) * open;
  const width = length * 0.4;
  const colors = leafPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => hollyPath(ctx, length, width), colors, length, width, "crasp");
  ctx.restore();
}

function drawIvy(ctx, open, random) {
  const size = (16.5 + random() * 2) * open;
  const colors = leafPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => ivyPath(ctx, size), colors, size, size * 0.7, "palmate");
  ctx.restore();
}

function drawMaple(ctx, open, random) {
  const size = (17.5 + random() * 2.2) * open;
  const colors = leafPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => maplePath(ctx, size), colors, size, size * 0.72, "palmate");
  ctx.restore();
}

function drawFig(ctx, open, random) {
  const size = (17 + random() * 2) * open;
  const colors = leafPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => figPath(ctx, size), colors, size, size * 0.62, "palmate");
  ctx.restore();
}

function drawHawthorn(ctx, open, random) {
  const size = (16.5 + random() * 2) * open;
  const colors = leafPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => hawthornPath(ctx, size), colors, size, size * 0.55, "crasp");
  ctx.restore();
}

function drawGinkgo(ctx, open, random) {
  const radius = (14.5 + random() * 2) * open;
  const colors = leafPalette(random);
  ctx.save();
  tilt(ctx, random, 0.08);
  paintModeledLeaf(ctx, () => ginkgoPath(ctx, radius), colors, radius, radius * 0.85, "fan");
  ctx.restore();
}

function drawRoseSprig(ctx, open, random) {
  const colors = leafPalette(random);
  ctx.save();
  const pairs = [
    { y: -4.2 * open, x: 5.4 * open, s: 0.48, rot: 1.05 },
    { y: -9.2 * open, x: 4.6 * open, s: 0.42, rot: 1.15 },
  ];
  pairs.forEach((pair) => {
    [-1, 1].forEach((side) => {
      ctx.save();
      ctx.translate(side * pair.x, pair.y);
      ctx.rotate(side * pair.rot);
      const length = 11 * open * pair.s * 2.2;
      const width = length * 0.36;
      paintModeledLeaf(ctx, () => {
        profilePath(ctx, length, (t) => ovateWidth(t, width) * (1 + 0.08 * Math.sin(t * Math.PI * 16)));
      }, colors, length, width, "crasp");
      ctx.restore();
    });
  });
  ctx.save();
  ctx.translate(0, -14.5 * open);
  const tip = 13 * open;
  paintModeledLeaf(ctx, () => {
    profilePath(ctx, tip, (t) => ovateWidth(t, tip * 0.34) * (1 + 0.08 * Math.sin(t * Math.PI * 16)));
  }, colors, tip, tip * 0.34, "crasp");
  ctx.restore();
  ctx.restore();
}

const FLOWER_TYPES = [
  drawBay,
  drawOlive,
  drawWillow,
  drawOak,
  drawHolly,
  drawIvy,
  drawMaple,
  drawFig,
  drawHawthorn,
  drawGinkgo,
  drawRoseSprig,
];

function drawLeaf(ctx, scale, side) {
  ctx.save();
  ctx.scale(side, 1);
  const colors = leafPalette(() => (side > 0 ? 0.7 : 0.2));
  const length = 7.4 * scale;
  const width = length * 0.34;
  paintModeledLeaf(ctx, () => bayPath(ctx, length, width), colors, length, width);
  ctx.restore();
}

function drawFlowStem(ctx, pts, stem, seed) {
  const random = mulberry32(seed ^ 0x9e3779b9);
  const visible = Math.max(2, Math.floor(1 + (pts.length - 1) * easeInOut(stem)));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < visible; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = "hsla(152, 48%, 16%, 0.82)";
  ctx.lineWidth = 1.7;
  ctx.stroke();
  ctx.strokeStyle = "hsla(44, 92%, 58%, 0.35)";
  ctx.lineWidth = 0.55;
  ctx.stroke();

  if (stem > 0.28) {
    const a = pointOnPath(pts, 0.38 * stem);
    const tan = tangentOnPath(pts, 0.38 * stem);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(Math.atan2(tan.y, tan.x) + 1.15);
    drawLeaf(ctx, stem * 1.55, 1);
    ctx.restore();
  }
  if (stem > 0.55) {
    const a = pointOnPath(pts, 0.68 * stem);
    const tan = tangentOnPath(pts, 0.68 * stem);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(Math.atan2(tan.y, tan.x) - 1.05);
    drawLeaf(ctx, stem * 1.35, -1);
    ctx.restore();
  }

  if (stem > 0.72 && random() > 0.45) {
    const a = pointOnPath(pts, 0.52);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(tangentOnPath(pts, 0.52).x);
    drawBay(ctx, stem * 0.72, random);
    ctx.restore();
  }
  ctx.restore();
}

function drawBloomAt(ctx, pts, bloom, stem, seed, scale) {
  const random = mulberry32(seed);
  const type = FLOWER_TYPES[seed % FLOWER_TYPES.length];
  const fade = easeOutCubic(Math.max(bloom, stem * 0.55));
  const open = easeOutBack(Math.min(1, bloom)) * scale;
  const tipT = Math.max(0.12, easeInOut(stem));
  const tip = pointOnPath(pts, tipT);
  const tan = tangentOnPath(pts, tipT);

  ctx.save();
  ctx.globalAlpha = fade;
  drawFlowStem(ctx, pts, stem, seed);
  if (bloom > 0.03) {
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(Math.atan2(tan.y, tan.x) + Math.PI / 2);
    type(ctx, open, random);
    ctx.restore();
  }
  ctx.restore();
}

function updateHoverBlooms(now) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const originX = gridOrigin(GRID, width);
  const originY = gridOrigin(GRID, height);
  const active = new Set();

  if (mouse.inside) {
    const minX = Math.floor((mouse.x - BLOOM_RADIUS - originX) / GRID);
    const maxX = Math.ceil((mouse.x + BLOOM_RADIUS - originX) / GRID);
    const minY = Math.floor((mouse.y - BLOOM_RADIUS - originY) / GRID);
    const maxY = Math.ceil((mouse.y + BLOOM_RADIUS - originY) / GRID);

    for (let ix = minX; ix <= maxX; ix += 1) {
      for (let iy = minY; iy <= maxY; iy += 1) {
        const x = originX + ix * GRID;
        const y = originY + iy * GRID;
        const dist = Math.hypot(x - mouse.x, y - mouse.y);
        if (dist > BLOOM_RADIUS) continue;

        const key = `${ix},${iy}`;
        active.add(key);
        let node = blooms.get(key);
        if (!node) {
          node = { x, y, seed: hash(ix, iy), revealedAt: now, bloom: 0, stem: 0, leftAt: 0 };
          blooms.set(key, node);
        }
        node.leftAt = 0;

        const wait = BLOOM_DELAY + (dist / BLOOM_RADIUS) * SPRAWL_STAGGER;
        const elapsed = now - node.revealedAt;
        if (elapsed > wait - STEM_LEAD) node.stem = Math.min(1, node.stem + BLOOM_SPEED * 1.4);
        if (elapsed > wait) node.bloom = Math.min(1, node.bloom + BLOOM_SPEED);
      }
    }
  }

  for (const [key, node] of blooms) {
    if (active.has(key)) continue;
    if (!node.leftAt) node.leftAt = now;
    if (now - node.leftAt < PERSIST_MS) continue;
    node.bloom = Math.max(0, node.bloom - FADE_SPEED);
    node.stem = Math.max(0, node.stem - FADE_SPEED * 1.15);
    if (node.bloom <= 0 && node.stem <= 0) blooms.delete(key);
  }

  return { originX, originY };
}

function drawHoverNodes(ctx, originX, originY) {
  if (!mouse.inside) return;
  const minX = mouse.x - REVEAL_RADIUS;
  const maxX = mouse.x + REVEAL_RADIUS;
  const minY = mouse.y - REVEAL_RADIUS;
  const maxY = mouse.y + REVEAL_RADIUS;

  for (let x = originX; x <= maxX + GRID; x += GRID) {
    if (x < minX) continue;
    for (let y = originY; y <= maxY + GRID; y += GRID) {
      if (y < minY) continue;
      const intensity = falloff(Math.hypot(x - mouse.x, y - mouse.y), REVEAL_RADIUS);
      if (intensity < 0.05) continue;
      ctx.beginPath();
      ctx.fillStyle = `rgba(32, 38, 46, ${0.15 + intensity * 0.45})`;
      ctx.arc(x, y, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawCursor(ctx) {
  if (!mouse.inside) return;
  ctx.beginPath();
  ctx.strokeStyle = "rgba(36, 46, 58, 0.35)";
  ctx.lineWidth = 1;
  ctx.arc(mouse.x, mouse.y, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = "rgba(36, 46, 58, 0.7)";
  ctx.arc(mouse.x, mouse.y, 1.4, 0, Math.PI * 2);
  ctx.fill();
}

const dropAnchors = [
  { ox: 0.16, oy: 0.2, type: 1, scale: 1.85 },
  { ox: 0.4, oy: 0.14, type: 0, scale: 2.05 },
  { ox: 0.26, oy: 0.46, type: 2, scale: 1.75 },
  { ox: 0.5, oy: 0.4, type: 0, scale: 1.95 },
  { ox: 0.12, oy: 0.66, type: 4, scale: 1.15 },
  { ox: 0.36, oy: 0.84, type: 6, scale: 1.55 },
  { ox: 0.06, oy: 0.36, type: 4, scale: 1.1 },
];

function drawGoldenSpiral(ctx, cx, cy, scale, now) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.35);
  ctx.beginPath();
  for (let a = 0.2; a < Math.PI * 5.2; a += 0.06) {
    const r = scale * Math.pow(PHI, (2 * a) / Math.PI) * 0.085;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (a === 0.2) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(242, 201, 76, 0.72)";
  ctx.lineWidth = 1.15;
  ctx.stroke();

  ctx.beginPath();
  for (let a = 0.4; a < Math.PI * 4.4; a += 0.06) {
    const r = scale * Math.pow(PHI, (2 * a) / Math.PI) * 0.055;
    const x = Math.cos(-a + now * 0.000012) * r;
    const y = Math.sin(-a + now * 0.000012) * r;
    if (a === 0.4) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(10, 61, 44, 0.45)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.restore();
}

function drawDropcap(ctx, now) {
  const box = dropLetter.getBoundingClientRect();
  if (box.width < 8) return;

  const cx = box.left + box.width * 0.38;
  const cy = box.top + box.height * 0.52;
  drawGoldenSpiral(ctx, cx, cy, Math.min(box.width, box.height) * 0.82, now);

  dropAnchors.forEach((anchor, index) => {
    const sx = box.left + box.width * anchor.ox;
    const sy = box.top + box.height * anchor.oy;
    const seed = hash(index + 11, 97);
    const pts = integrateStream(sx, sy, seed, now, 40, 0.55);
    const breathe = 0.82 + Math.sin(now * 0.00018 + index) * 0.08;
    drawBloomAt(ctx, pts, breathe, 0.92 + Math.sin(now * 0.0001 + index * 0.6) * 0.06, seed, anchor.scale);
  });
}

function frame(now) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  fieldCtx.clearRect(0, 0, width, height);
  illumCtx.clearRect(0, 0, width, height);

  const { originX, originY } = updateHoverBlooms(now);
  drawGrid(fieldCtx);
  drawHoverNodes(fieldCtx, originX, originY);

  for (const node of blooms.values()) {
    if (node.stem < 0.02 && node.bloom < 0.02) continue;
    const pts = integrateStream(node.x, node.y, node.seed, now, 46, 0.52);
    drawBloomAt(fieldCtx, pts, node.bloom, node.stem, node.seed, 1.65);
  }

  drawCursor(fieldCtx);
  drawDropcap(illumCtx, now);
  requestAnimationFrame(frame);
}

resize();
requestAnimationFrame(frame);
