const field = document.getElementById("field");
const fieldCtx = field.getContext("2d", { alpha: true });
const illum = document.getElementById("illumination");
const illumCtx = illum.getContext("2d", { alpha: true });
const dropLetter = document.querySelector(".drop-letter");

const GRID = 22;
const REVEAL_RADIUS = 64;
const BLOOM_RADIUS = 72;
const BLOOM_DELAY = 1280;
const SPRAWL_STAGGER = 2100;
const STEM_LEAD = 260;
const GRID_REVEAL_MS = 920;
const BLOOM_SPEED = 0.0034;
const FADE_SPEED = 0.003;
const PERSIST_MS = 3600;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const PHI = (1 + Math.sqrt(5)) / 2;

const mouse = { x: -9999, y: -9999, inside: false };
const lastMouse = { x: -9999, y: -9999 };
const pointerField = { since: 0, leftAt: 0 };
const blooms = new Map();
const dust = [];
const gust = [];

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

function updatePointerField(now) {
  if (mouse.inside) {
    if (!pointerField.since || pointerField.leftAt) {
      pointerField.since = now;
      pointerField.leftAt = 0;
    }
    return;
  }
  if (pointerField.since && !pointerField.leftAt) pointerField.leftAt = now;
  if (pointerField.leftAt && now - pointerField.leftAt > 480) {
    pointerField.since = 0;
    pointerField.leftAt = 0;
  }
}

function gridProgress(now) {
  if (!pointerField.since) return 0;
  const grown = easeOutCubic(Math.min(1, (now - pointerField.since) / GRID_REVEAL_MS));
  if (!pointerField.leftAt) return grown;
  return grown * (1 - Math.min(1, (now - pointerField.leftAt) / 420));
}

function cellAppear(progress, dist) {
  const ring = dist / REVEAL_RADIUS;
  return easeOutCubic(Math.max(0, Math.min(1, (progress - ring * 0.72) / 0.28)));
}

function drawGrid(ctx, now) {
  const progress = gridProgress(now);
  if (progress < 0.01) return;

  const width = window.innerWidth;
  const height = window.innerHeight;
  const originX = gridOrigin(GRID, width);
  const originY = gridOrigin(GRID, height);
  const mx = mouse.inside ? mouse.x : lastMouse.x;
  const my = mouse.inside ? mouse.y : lastMouse.y;
  const radius = REVEAL_RADIUS * (0.16 + 0.84 * progress);
  const minX = mx - radius;
  const maxX = mx + radius;
  const minY = my - radius;
  const maxY = my + radius;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 0.7;

  for (let x = originX; x <= width + GRID; x += GRID) {
    if (x < minX || x > maxX) continue;
    for (let y = originY; y <= height; y += GRID) {
      const y2 = y + GRID;
      if (y2 < minY || y > maxY) continue;
      const midY = y + GRID * 0.5;
      const dist = Math.hypot(x - mx, midY - my);
      const local = cellAppear(progress, dist);
      if (local < 0.02) continue;
      const reach = falloff(dist, radius);
      if (reach < 0.04) continue;
      const grown = GRID * local;
      const from = midY - grown * 0.5;
      ctx.globalAlpha = local * reach * 0.85;
      ctx.strokeStyle = "rgba(214, 196, 132, 0.42)";
      ctx.beginPath();
      ctx.moveTo(x, from);
      ctx.lineTo(x, from + grown);
      ctx.stroke();
    }
  }

  for (let y = originY; y <= height + GRID; y += GRID) {
    if (y < minY || y > maxY) continue;
    for (let x = originX; x <= width; x += GRID) {
      const x2 = x + GRID;
      if (x2 < minX || x > maxX) continue;
      const midX = x + GRID * 0.5;
      const dist = Math.hypot(midX - mx, y - my);
      const local = cellAppear(progress, dist);
      if (local < 0.02) continue;
      const reach = falloff(dist, radius);
      if (reach < 0.04) continue;
      const grown = GRID * local;
      const from = midX - grown * 0.5;
      ctx.globalAlpha = local * reach * 0.85;
      ctx.strokeStyle = "rgba(214, 196, 132, 0.42)";
      ctx.beginPath();
      ctx.moveTo(from, y);
      ctx.lineTo(from + grown, y);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function hsla(h, s, l, a) {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

function leafPalette(random) {
  const roll = random();
  const j = () => random();

  if (roll < 0.14) {
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
  if (roll < 0.26) {
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
  if (roll < 0.36) {
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
  if (roll < 0.5) {
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
  if (roll < 0.58) {
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
  if (roll < 0.74) {
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
  if (roll < 0.86) {
    const h = 18 + j() * 16;
    return {
      umber: hsla(16, 52, 12, 0.84),
      body: hsla(h, 78 + j() * 12, 36 + j() * 6, 0.94),
      mid: hsla(h + 10, 80 + j() * 10, 48 + j() * 8, 0.9),
      light: hsla(36 + j() * 10, 84, 58 + j() * 8, 0.68),
      gleam: hsla(42, 88, 68, 0.4),
      vein: hsla(16, 42, 20, 0.42),
      gilt: hsla(32, 80, 50, 0.52),
    };
  }
  const h = random() < 0.5 ? 6 + j() * 14 : 350 + j() * 12;
  return {
    umber: hsla(8, 48, 12, 0.82),
    body: hsla(h, 62 + j() * 14, 30 + j() * 6, 0.93),
    mid: hsla(h + 8, 66 + j() * 12, 42 + j() * 8, 0.88),
    light: hsla(26 + j() * 12, 72, 54 + j() * 8, 0.64),
    gleam: hsla(38, 78, 62, 0.36),
    vein: hsla(12, 40, 20, 0.4),
    gilt: hsla(34, 76, 48, 0.5),
  };
}

function mapleAutumnPalette(random) {
  const j = () => random();
  const roll = random();
  let h;
  let sat;
  let lit;
  if (roll < 0.2) {
    h = 44 + j() * 10;
    sat = 88 + j() * 12;
    lit = 46 + j() * 10;
  } else if (roll < 0.42) {
    h = 28 + j() * 12;
    sat = 84 + j() * 14;
    lit = 42 + j() * 10;
  } else if (roll < 0.68) {
    h = 8 + j() * 14;
    sat = 78 + j() * 16;
    lit = 38 + j() * 8;
  } else if (roll < 0.84) {
    h = random() < 0.5 ? 2 + j() * 8 : 348 + j() * 10;
    sat = 62 + j() * 16;
    lit = 28 + j() * 8;
  } else {
    h = 16 + j() * 12;
    sat = 70 + j() * 14;
    lit = 34 + j() * 8;
  }
  return {
    umber: hsla(h - 8, sat * 0.55, Math.max(10, lit - 22), 0.86),
    body: hsla(h, sat, lit, 0.96),
    mid: hsla(h + 6, Math.min(100, sat + 6), lit + 12, 0.92),
    light: hsla(h + 12, Math.min(100, sat + 8), lit + 24, 0.74),
    gleam: hsla(48, 100, 82, 0.5),
    vein: hsla(h - 6, 42, 18, 0.48),
    gilt: hsla(42, 92, 62, 0.62),
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
    const tooth = 1 + 0.02 * Math.sin(t * Math.PI * 14);
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
  const s = size;
  ctx.beginPath();
  ctx.moveTo(0, s * 0.05);
  ctx.lineTo(s * 0.07, 0);
  ctx.bezierCurveTo(s * 0.2, s * 0.02, s * 0.38, -s * 0.01, s * 0.52, -s * 0.1);
  ctx.lineTo(s * 0.74, s * 0.01);
  ctx.lineTo(s * 0.58, -s * 0.14);
  ctx.lineTo(s * 0.9, -s * 0.16);
  ctx.lineTo(s * 0.56, -s * 0.26);
  ctx.bezierCurveTo(s * 0.86, -s * 0.3, s * 1.08, -s * 0.38, s * 0.96, -s * 0.5);
  ctx.lineTo(s * 0.68, -s * 0.43);
  ctx.lineTo(s * 0.84, -s * 0.6);
  ctx.lineTo(s * 0.5, -s * 0.5);
  ctx.bezierCurveTo(s * 0.4, -s * 0.7, s * 0.16, -s * 0.9, 0, -s);
  ctx.bezierCurveTo(-s * 0.16, -s * 0.9, -s * 0.4, -s * 0.7, -s * 0.5, -s * 0.5);
  ctx.lineTo(-s * 0.84, -s * 0.6);
  ctx.lineTo(-s * 0.68, -s * 0.43);
  ctx.bezierCurveTo(-s * 1.08, -s * 0.38, -s * 0.86, -s * 0.3, -s * 0.56, -s * 0.26);
  ctx.lineTo(-s * 0.9, -s * 0.16);
  ctx.lineTo(-s * 0.58, -s * 0.14);
  ctx.lineTo(-s * 0.74, s * 0.01);
  ctx.bezierCurveTo(-s * 0.38, -s * 0.01, -s * 0.2, s * 0.02, -s * 0.07, 0);
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

function drawMaple(ctx, open, random, simple = false) {
  const size = (21 + random() * 6) * open;
  const colors = mapleAutumnPalette(random);
  ctx.save();
  tilt(ctx, random, 0.22);
  if (simple) {
    maplePath(ctx, size);
    ctx.fillStyle = colors.body;
    ctx.fill();
    maplePath(ctx, size);
    ctx.strokeStyle = colors.gilt;
    ctx.lineWidth = 0.45;
    ctx.stroke();
  } else {
    paintModeledLeaf(ctx, () => maplePath(ctx, size), colors, size, size * 0.92, "palmate");
  }
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
        profilePath(ctx, length, (t) => ovateWidth(t, width));
      }, colors, length, width, "crasp");
      ctx.restore();
    });
  });
  ctx.save();
  ctx.translate(0, -14.5 * open);
  const tip = 13 * open;
  paintModeledLeaf(ctx, () => {
    profilePath(ctx, tip, (t) => ovateWidth(t, tip * 0.34));
  }, colors, tip, tip * 0.34, "crasp");
  ctx.restore();
  ctx.restore();
}

const FLOWER_TYPES = [
  drawMaple,
  drawMaple,
  drawMaple,
  drawMaple,
  drawMaple,
  drawOak,
  drawMaple,
  drawGinkgo,
  drawMaple,
  drawFig,
];

function drawLeaf(ctx, scale, side) {
  ctx.save();
  ctx.scale(side, 1);
  const colors = mapleAutumnPalette(() => (side > 0 ? 0.62 : 0.28));
  const length = 9.2 * scale;
  paintModeledLeaf(ctx, () => maplePath(ctx, length), colors, length, length * 0.86, "palmate");
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

  const sideLeaves = [
    { at: 0.22, side: 1, scale: 1.25, rot: 1.12 },
    { at: 0.36, side: -1, scale: 1.4, rot: -1.05 },
    { at: 0.5, side: 1, scale: 1.55, rot: 1.18 },
    { at: 0.64, side: -1, scale: 1.45, rot: -1.1 },
    { at: 0.78, side: 1, scale: 1.2, rot: 1.02 },
  ];
  sideLeaves.forEach((leaf) => {
    if (stem < leaf.at) return;
    const a = pointOnPath(pts, leaf.at * stem);
    const tan = tangentOnPath(pts, leaf.at * stem);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(Math.atan2(tan.y, tan.x) + leaf.rot);
    drawLeaf(ctx, stem * leaf.scale, leaf.side);
    ctx.restore();
  });

  if (stem > 0.58) {
    const a = pointOnPath(pts, 0.48);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(tangentOnPath(pts, 0.48).x);
    drawMaple(ctx, stem * 0.78, random);
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

function drawHoverNodes(ctx, originX, originY, now) {
  const progress = gridProgress(now);
  if (progress < 0.01) return;
  const mx = mouse.inside ? mouse.x : lastMouse.x;
  const my = mouse.inside ? mouse.y : lastMouse.y;
  const radius = REVEAL_RADIUS * (0.16 + 0.84 * progress);
  const minX = mx - radius;
  const maxX = mx + radius;
  const minY = my - radius;
  const maxY = my + radius;

  for (let x = originX; x <= maxX + GRID; x += GRID) {
    if (x < minX) continue;
    for (let y = originY; y <= maxY + GRID; y += GRID) {
      if (y < minY) continue;
      const dist = Math.hypot(x - mx, y - my);
      const local = cellAppear(progress, dist);
      const intensity = falloff(dist, radius) * local;
      if (intensity < 0.05) continue;
      ctx.beginPath();
      ctx.fillStyle = `rgba(232, 215, 150, ${0.16 + intensity * 0.55})`;
      ctx.arc(x, y, 0.45 + local * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function duneHeight(x, width, height, layer) {
  const t = x / width;
  const crest = Math.sin(t * Math.PI * (1.35 + layer * 0.28) + layer * 1.35);
  const slip = Math.sin(t * Math.PI * 2.8 + layer * 2.4) * 0.32;
  const n = noise3(x * 0.0018, layer * 1.6, 0.22);
  const base = 0.4 + layer * 0.08;
  return height * base + crest * height * 0.07 + slip * height * 0.028 + (n - 0.5) * height * 0.04;
}

function drawArrakis(ctx, width, height, now) {
  const moonA = { x: width * 0.74, y: height * 0.13, r: 34 };
  const moonB = { x: width * 0.83, y: height * 0.2, r: 16 };
  const glowA = ctx.createRadialGradient(moonA.x, moonA.y, 0, moonA.x, moonA.y, moonA.r * 2.6);
  glowA.addColorStop(0, "rgba(224, 210, 176, 0.18)");
  glowA.addColorStop(0.42, "rgba(200, 184, 142, 0.06)");
  glowA.addColorStop(1, "rgba(200, 184, 142, 0)");
  ctx.fillStyle = glowA;
  ctx.fillRect(moonA.x - moonA.r * 2.6, moonA.y - moonA.r * 2.6, moonA.r * 5.2, moonA.r * 5.2);
  ctx.beginPath();
  ctx.fillStyle = "rgba(226, 214, 184, 0.26)";
  ctx.arc(moonA.x, moonA.y, 6.8, 0, Math.PI * 2);
  ctx.fill();

  const glowB = ctx.createRadialGradient(moonB.x, moonB.y, 0, moonB.x, moonB.y, moonB.r * 2.2);
  glowB.addColorStop(0, "rgba(196, 158, 98, 0.14)");
  glowB.addColorStop(1, "rgba(196, 158, 98, 0)");
  ctx.fillStyle = glowB;
  ctx.fillRect(moonB.x - moonB.r * 2.2, moonB.y - moonB.r * 2.2, moonB.r * 4.4, moonB.r * 4.4);
  ctx.beginPath();
  ctx.fillStyle = "rgba(198, 164, 108, 0.2)";
  ctx.arc(moonB.x, moonB.y, 3.2, 0, Math.PI * 2);
  ctx.fill();

  const stars = mulberry32(2024);
  for (let i = 0; i < 70; i += 1) {
    const x = stars() * width;
    const y = stars() * height * 0.4;
    const twinkle = 0.6 + 0.4 * Math.sin(now * 0.00045 + i * 1.7);
    ctx.fillStyle = `rgba(228, 218, 190, ${(0.07 + stars() * 0.18) * twinkle})`;
    ctx.fillRect(x, y, 0.8, 0.8);
  }

  const layers = [
    { fill: "rgba(42, 32, 28, 0.28)", shade: "rgba(18, 12, 10, 0.2)", light: "rgba(168, 138, 96, 0.07)" },
    { fill: "rgba(52, 36, 24, 0.38)", shade: "rgba(22, 14, 10, 0.24)", light: "rgba(176, 140, 92, 0.08)" },
    { fill: "rgba(58, 38, 22, 0.5)", shade: "rgba(24, 14, 8, 0.28)", light: "rgba(186, 148, 92, 0.1)" },
    { fill: "rgba(46, 30, 16, 0.62)", shade: "rgba(16, 10, 6, 0.32)", light: "rgba(190, 150, 88, 0.11)" },
    { fill: "rgba(32, 20, 12, 0.74)", shade: "rgba(10, 6, 4, 0.28)", light: "rgba(160, 120, 72, 0.1)" },
  ];

  layers.forEach((tone, layer) => {
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, duneHeight(0, width, height, layer));
    for (let x = 8; x <= width; x += 8) {
      ctx.lineTo(x, duneHeight(x, width, height, layer));
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = tone.fill;
    ctx.fill();

    ctx.save();
    ctx.clip();
    const shade = ctx.createLinearGradient(0, height * (0.38 + layer * 0.08), width * 0.7, height);
    shade.addColorStop(0, tone.light);
    shade.addColorStop(0.45, "rgba(0, 0, 0, 0)");
    shade.addColorStop(1, tone.shade);
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);

    if (layer >= 2) {
      ctx.strokeStyle = "rgba(150, 112, 68, 0.1)";
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 22; i += 1) {
        const y0 = height * (0.5 + layer * 0.06) + i * 6;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 12) {
          const y = y0 + Math.sin(x * 0.028 + layer * 1.4 + i * 0.4) * 2.4 + noise3(x * 0.01, i * 0.2, layer) * 3;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(0, duneHeight(0, width, height, layer));
      for (let x = 8; x <= width; x += 8) {
        ctx.lineTo(x, duneHeight(x, width, height, layer));
      }
      ctx.strokeStyle = "rgba(210, 176, 118, 0.16)";
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    ctx.restore();
  });

  const haze = ctx.createLinearGradient(0, height * 0.36, 0, height * 0.52);
  haze.addColorStop(0, "rgba(18, 12, 10, 0)");
  haze.addColorStop(0.5, "rgba(86, 58, 32, 0.1)");
  haze.addColorStop(1, "rgba(18, 12, 10, 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, height * 0.36, width, height * 0.16);

  const grit = mulberry32(77);
  for (let i = 0; i < 220; i += 1) {
    const x = grit() * width;
    const y = height * (0.48 + grit() * 0.5);
    ctx.fillStyle = `rgba(186, 148, 88, ${0.04 + grit() * 0.1})`;
    ctx.fillRect(x, y, 1 + grit(), 1);
  }
  for (let i = 0; i < 18; i += 1) {
    const x = grit() * width;
    const y = height * (0.62 + grit() * 0.32);
    ctx.fillStyle = `rgba(12, 8, 6, ${0.18 + grit() * 0.28})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + grit() * 7, 1.2 + grit() * 2.2, grit() * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDuneMatrix(ctx, width, height, now) {
  const originX = gridOrigin(GRID, width);
  const originY = gridOrigin(GRID, height);
  ctx.save();
  ctx.lineWidth = 0.55;
  for (let x = originX; x <= width; x += GRID) {
    for (let y = originY; y <= height; y += GRID) {
      const ground = duneHeight(x, width, height, 1);
      if (y < ground - 6) continue;
      const pulse = noise3(x * 0.018, y * 0.018, now * 0.00007);
      const wave = 0.5 + 0.5 * Math.sin(now * 0.00055 + x * 0.012 + y * 0.008);
      const fade = Math.max(0, pulse * wave - 0.42);
      if (fade < 0.04) continue;
      ctx.strokeStyle = `rgba(196, 170, 110, ${0.03 + fade * 0.16})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + GRID, y);
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + GRID);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function spawnMapleGust(x, y, amount) {
  for (let i = 0; i < amount; i += 1) {
    gust.push({
      x: x + (Math.random() - 0.5) * 18,
      y: y + (Math.random() - 0.5) * 10,
      vx: 0.08 + Math.random() * 0.16,
      vy: 0.04 + Math.random() * 0.08,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.02,
      life: 1,
      decay: 0.0007 + Math.random() * 0.0008,
      size: 0.42 + Math.random() * 0.32,
      seed: (Math.random() * 1e9) | 0,
    });
  }
}

function seedAmbientMaples() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  for (let i = 0; i < 5; i += 1) {
    spawnMapleGust(Math.random() * width, Math.random() * height * 0.7);
  }
}

function updateGust() {
  if (gust.length < 8 && Math.random() < 0.012) {
    spawnMapleGust(Math.random() * window.innerWidth, -20);
  }

  for (let i = gust.length - 1; i >= 0; i -= 1) {
    const leaf = gust[i];
    leaf.x += leaf.vx;
    leaf.y += leaf.vy;
    leaf.vy += 0.0012;
    leaf.vx *= 0.998;
    leaf.rot += leaf.spin;
    leaf.life -= leaf.decay;
    if (leaf.life <= 0 || leaf.y > window.innerHeight + 40) gust.splice(i, 1);
  }
}

function drawGust(ctx) {
  for (const leaf of gust) {
    const random = mulberry32(leaf.seed);
    ctx.save();
    ctx.globalAlpha = Math.max(0, leaf.life) * 0.92;
    ctx.translate(leaf.x, leaf.y);
    ctx.rotate(leaf.rot);
    drawMaple(ctx, leaf.size, random, true);
    ctx.restore();
  }
}

function spawnDust(x, y, amount) {
  for (let i = 0; i < amount; i += 1) {
    const gilt = Math.random() < 0.32;
    dust.push({
      x: x + (Math.random() - 0.5) * 7,
      y: y + 2 + (Math.random() - 0.4) * 5,
      vx: (Math.random() - 0.5) * 0.32,
      vy: 0.02 + Math.random() * 0.08,
      life: 1,
      decay: 0.001 + Math.random() * 0.0016,
      r: 0.35 + Math.random() * 1.15,
      hue: gilt ? 36 + Math.random() * 10 : 22 + Math.random() * 14,
      sat: gilt ? 48 + Math.random() * 22 : 32 + Math.random() * 20,
      light: gilt ? 42 + Math.random() * 18 : 26 + Math.random() * 16,
    });
  }
}

function updateDust() {
  if (mouse.inside) {
    const speed = Math.hypot(mouse.x - lastMouse.x, mouse.y - lastMouse.y);
    spawnDust(mouse.x, mouse.y, 1 + Math.min(7, Math.floor(speed * 0.4)));
  }
  lastMouse.x = mouse.x;
  lastMouse.y = mouse.y;

  for (let i = dust.length - 1; i >= 0; i -= 1) {
    const grain = dust[i];
    grain.x += grain.vx;
    grain.y += grain.vy;
    grain.vy += 0.002;
    grain.vx *= 0.985;
    grain.life -= grain.decay;
    if (grain.life <= 0 || grain.y > window.innerHeight + 8) dust.splice(i, 1);
  }
  if (dust.length > 420) dust.splice(0, dust.length - 420);
}

function drawDust(ctx) {
  for (const grain of dust) {
    ctx.beginPath();
    ctx.fillStyle = `hsla(${grain.hue}, ${grain.sat}%, ${grain.light}%, ${grain.life * 0.72})`;
    ctx.arc(grain.x, grain.y, grain.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCursor(ctx) {
  if (!mouse.inside) return;
  ctx.beginPath();
  ctx.strokeStyle = "rgba(232, 215, 150, 0.45)";
  ctx.lineWidth = 1;
  ctx.arc(mouse.x, mouse.y, 3.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = "rgba(196, 148, 72, 0.9)";
  ctx.arc(mouse.x, mouse.y, 1.05, 0, Math.PI * 2);
  ctx.fill();
}

const dropAnchors = [
  { ox: 0.16, oy: 0.2, type: 0, scale: 1.85 },
  { ox: 0.4, oy: 0.14, type: 0, scale: 2.05 },
  { ox: 0.26, oy: 0.46, type: 0, scale: 1.75 },
  { ox: 0.5, oy: 0.4, type: 0, scale: 1.95 },
  { ox: 0.12, oy: 0.66, type: 0, scale: 1.15 },
  { ox: 0.36, oy: 0.84, type: 2, scale: 1.55 },
  { ox: 0.06, oy: 0.36, type: 0, scale: 1.1 },
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

  dropAnchors.forEach((anchor, index) => {
    const sx = box.left + box.width * anchor.ox;
    const sy = box.top + box.height * anchor.oy;
    const seed = hash(index + 11, 97);
    const pts = integrateStream(sx, sy, seed, now * 0.18, 34, 0.46);
    const breathe = 0.76 + Math.sin(now * 0.000045 + index) * 0.035;
    drawBloomAt(ctx, pts, breathe, 0.86 + Math.sin(now * 0.000028 + index * 0.6) * 0.025, seed, anchor.scale * 0.82);
  });
}

function frame(now) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  fieldCtx.clearRect(0, 0, width, height);
  illumCtx.clearRect(0, 0, width, height);

  drawArrakis(fieldCtx, width, height, now);
  drawDuneMatrix(fieldCtx, width, height, now);
  updatePointerField(now);
  const { originX, originY } = updateHoverBlooms(now);
  drawGrid(fieldCtx, now);
  drawHoverNodes(fieldCtx, originX, originY, now);

  for (const node of blooms.values()) {
    if (node.stem < 0.02 && node.bloom < 0.02) continue;
    const pts = integrateStream(node.x, node.y, node.seed, now, 58, 0.62);
    drawBloomAt(fieldCtx, pts, node.bloom, node.stem, node.seed, 1.75);
  }

  updateDust();
  drawDust(fieldCtx);
  drawCursor(fieldCtx);
  drawDropcap(illumCtx, now);
  requestAnimationFrame(frame);
}

resize();
requestAnimationFrame(frame);
