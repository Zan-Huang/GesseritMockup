const field = document.getElementById("field");
const fieldCtx = field.getContext("2d", { alpha: true });
const illum = document.getElementById("illumination");
const illumCtx = illum.getContext("2d", { alpha: true });
const dropLetter = document.querySelector(".drop-letter");
const restLetter = document.querySelector(".rest");

const GRID = 12;
const REVEAL_RADIUS = 86;
const BLOOM_RADIUS = 168;
const BLOOM_DELAY = 180;
const SPRAWL_STAGGER = 980;
const STEM_LEAD = 180;
const GRID_REVEAL_MS = 920;
const BLOOM_SPEED_FAST = 0.012;
const BLOOM_SPEED_SLOW = 0.0022;
const FADE_SPEED = 0.0007;
const PERSIST_MS = 24000;
const MAX_BLOOMS = 72;
const GRID_STICK_MS = 16000;
const GRID_STICK_FADE = 0.00055;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const PHI = (1 + Math.sqrt(5)) / 2;

const mouse = { x: -9999, y: -9999, inside: false };
const lastMouse = { x: -9999, y: -9999 };
const pointerField = { since: 0, leftAt: 0 };
const blooms = new Map();
let bloomSeq = 0;
let lastPlantAt = 0;
const stuckGrid = new Map();
const dust = [];
const gust = [];
const world = { lit: false };
const torchBtn = document.querySelector(".torch");

function paintedSister() {
  const img = document.querySelector(".sister");
  if (!img) return { left: 0, top: 0, width: 0, height: 0 };
  const box = img.getBoundingClientRect();
  const nw = img.naturalWidth || 1024;
  const nh = img.naturalHeight || 1536;
  const scale = Math.max(box.width / nw, box.height / nh);
  const width = nw * scale;
  const height = nh * scale;
  const extraX = width - box.width;
  const extraY = height - box.height;
  return {
    left: box.left - extraX * 0.4,
    top: box.top - extraY * 0.08,
    width,
    height,
  };
}

function torchAnchor() {
  const box = paintedSister();
  return { x: box.left + box.width * 0.887, y: box.top + box.height * 0.164 };
}

function hitTorch(x, y) {
  const box = paintedSister();
  if (box.width < 8 || box.height < 8) return false;
  const rx = (x - box.left) / box.width;
  const ry = (y - box.top) / box.height;
  return rx >= 0.76 && rx <= 1.05 && ry >= 0.04 && ry <= 0.34;
}

function setWorldLit(on) {
  world.lit = on;
  document.body.classList.toggle("lit", on);
  if (torchBtn) {
    torchBtn.classList.toggle("is-lit", on);
    torchBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function toggleTorch() {
  setWorldLit(!world.lit);
  const flame = torchAnchor();
  spawnDust(flame.x, flame.y, world.lit ? 36 : 10);
}

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

function growthRate(progress) {
  const s = 1 / (1 + Math.exp(-8.5 * (progress - 0.4)));
  return lerp(BLOOM_SPEED_FAST, BLOOM_SPEED_SLOW, s);
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

function onPointer(event) {
  setPointer(event.clientX, event.clientY, true);
}

function onPointerDown(event) {
  onPointer(event);
  if (hitTorch(event.clientX, event.clientY)) toggleTorch();
}

document.addEventListener("pointermove", onPointer, { passive: true });
document.addEventListener("pointerdown", onPointerDown);
document.addEventListener("pointerenter", onPointer, { passive: true });
window.addEventListener("pointermove", onPointer, { passive: true });

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

function updateStuckGrid(now) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const originX = gridOrigin(GRID, width);
  const originY = gridOrigin(GRID, height);
  const live = new Set();

  if (mouse.inside) {
    const minX = Math.floor((mouse.x - REVEAL_RADIUS - originX) / GRID);
    const maxX = Math.ceil((mouse.x + REVEAL_RADIUS - originX) / GRID);
    const minY = Math.floor((mouse.y - REVEAL_RADIUS - originY) / GRID);
    const maxY = Math.ceil((mouse.y + REVEAL_RADIUS - originY) / GRID);

    for (let ix = minX; ix <= maxX; ix += 1) {
      for (let iy = minY; iy <= maxY; iy += 1) {
        const x = originX + ix * GRID;
        const y = originY + iy * GRID;
        const dist = Math.hypot(x - mouse.x, y - mouse.y);
        if (dist > REVEAL_RADIUS) continue;
        const key = `${ix},${iy}`;
        live.add(key);
        let cell = stuckGrid.get(key);
        if (!cell) {
          cell = { x, y, strength: 0, leftAt: 0 };
          stuckGrid.set(key, cell);
        }
        cell.strength = Math.min(1, cell.strength + 0.045 + falloff(dist, REVEAL_RADIUS) * 0.04);
        cell.leftAt = 0;
      }
    }
  }

  for (const [key, cell] of stuckGrid) {
    if (live.has(key)) continue;
    if (!cell.leftAt) cell.leftAt = now;
    if (now - cell.leftAt < GRID_STICK_MS) continue;
    cell.strength = Math.max(0, cell.strength - GRID_STICK_FADE);
    if (cell.strength <= 0) stuckGrid.delete(key);
  }

  if (stuckGrid.size > 520) {
    const extra = stuckGrid.size - 520;
    let dropped = 0;
    for (const [key, cell] of stuckGrid) {
      if (cell.leftAt && dropped < extra) {
        stuckGrid.delete(key);
        dropped += 1;
      }
    }
  }
}

function drawStuckGrid(ctx) {
  if (stuckGrid.size === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 0.65;
  for (const cell of stuckGrid.values()) {
    if (cell.strength < 0.03) continue;
    const a = cell.strength * 0.38;
    ctx.globalAlpha = a;
    ctx.strokeStyle = "rgba(214, 214, 220, 0.95)";
    const span = GRID * (0.35 + cell.strength * 0.65);
    ctx.beginPath();
    ctx.moveTo(cell.x, cell.y);
    ctx.lineTo(cell.x + span, cell.y);
    ctx.moveTo(cell.x, cell.y);
    ctx.lineTo(cell.x, cell.y + span);
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = `rgba(226, 226, 232, ${0.18 + cell.strength * 0.4})`;
    ctx.arc(cell.x, cell.y, 0.45 + cell.strength * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
      ctx.strokeStyle = "rgba(198, 198, 202, 0.4)";
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
      ctx.strokeStyle = "rgba(198, 198, 202, 0.4)";
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
  return mapleAutumnPalette(random);
}

function desertPalette(random) {
  const roll = random();
  if (roll < 0.34) {
    return {
      umber: "#3d3a2e",
      body: "#5c5848",
      mid: "#6e6956",
      light: "#827c66",
      gleam: "rgba(140, 132, 108, 0.22)",
      vein: "#353226",
      gilt: "#6a6554",
    };
  }
  if (roll < 0.67) {
    return {
      umber: "#3a3d30",
      body: "#555848",
      mid: "#666a54",
      light: "#7a7c64",
      gleam: "rgba(130, 132, 108, 0.2)",
      vein: "#2f3226",
      gilt: "#5e624c",
    };
  }
  return {
    umber: "#40362c",
    body: "#615648",
    mid: "#746858",
    light: "#8a7c68",
    gleam: "rgba(150, 132, 108, 0.2)",
    vein: "#342c24",
    gilt: "#6c6050",
  };
}

function mapleAutumnPalette(random) {
  return desertPalette(random);
}

function mapleAutumnPaletteLegacy(random) {
  const roll = random();
  if (roll < 0.12) {
    return {
      umber: "#1b5e20",
      body: "#2e7d32",
      mid: "#43a047",
      light: "#81c784",
      gleam: "rgba(165, 214, 167, 0.5)",
      vein: "#145218",
      gilt: "#66bb6a",
    };
  }
  if (roll < 0.2) {
    return {
      umber: "#4a6b12",
      body: "#827717",
      mid: "#afb42b",
      light: "#d4e157",
      gleam: "rgba(220, 231, 117, 0.5)",
      vein: "#3d4f0e",
      gilt: "#c0ca33",
    };
  }
  if (roll < 0.42) {
    return {
      umber: "#c39b0a",
      body: "#f1c40f",
      mid: "#f4d03f",
      light: "#ffe566",
      gleam: "rgba(255, 230, 120, 0.62)",
      vein: "#8a5a12",
      gilt: "#ffd54a",
    };
  }
  if (roll < 0.66) {
    return {
      umber: "#b85c10",
      body: "#e67e22",
      mid: "#f39c12",
      light: "#ffb36b",
      gleam: "rgba(255, 196, 96, 0.55)",
      vein: "#7a3b0c",
      gilt: "#ffb347",
    };
  }
  if (roll < 0.86) {
    return {
      umber: "#8e1b1b",
      body: "#d32f2f",
      mid: "#e74c3c",
      light: "#ff7a70",
      gleam: "rgba(255, 140, 120, 0.5)",
      vein: "#6b1212",
      gilt: "#ff6b5a",
    };
  }
  return {
    umber: "#8e3b00",
    body: "#d35400",
    mid: "#e67e22",
    light: "#ff9a4a",
    gleam: "rgba(255, 170, 80, 0.5)",
    vein: "#6b2c00",
    gilt: "#ff8c3a",
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
  ctx.quadraticCurveTo(s * 0.07, s * 0.015, s * 0.11, -s * 0.02);
  ctx.bezierCurveTo(s * 0.36, s * 0.03, s * 0.58, -s * 0.03, s * 0.66, -s * 0.16);
  ctx.quadraticCurveTo(s * 0.5, -s * 0.18, s * 0.38, -s * 0.23);
  ctx.bezierCurveTo(s * 0.74, -s * 0.26, s * 0.98, -s * 0.38, s * 0.84, -s * 0.52);
  ctx.quadraticCurveTo(s * 0.56, -s * 0.46, s * 0.34, -s * 0.52);
  ctx.bezierCurveTo(s * 0.4, -s * 0.7, s * 0.16, -s * 0.92, 0, -s);
  ctx.bezierCurveTo(-s * 0.16, -s * 0.92, -s * 0.4, -s * 0.7, -s * 0.34, -s * 0.52);
  ctx.quadraticCurveTo(-s * 0.56, -s * 0.46, -s * 0.84, -s * 0.52);
  ctx.bezierCurveTo(-s * 0.98, -s * 0.38, -s * 0.74, -s * 0.26, -s * 0.38, -s * 0.23);
  ctx.quadraticCurveTo(-s * 0.5, -s * 0.18, -s * 0.66, -s * 0.16);
  ctx.bezierCurveTo(-s * 0.58, -s * 0.03, -s * 0.36, s * 0.03, -s * 0.11, -s * 0.02);
  ctx.quadraticCurveTo(-s * 0.07, s * 0.015, 0, s * 0.05);
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
  ctx.fillStyle = colors.body;
  ctx.fill();

  ctx.save();
  pathFn();
  ctx.clip();
  const shade = ctx.createLinearGradient(-width, 0, width * 0.65, -length);
  shade.addColorStop(0, colors.body);
  shade.addColorStop(0.22, colors.mid);
  shade.addColorStop(0.62, colors.mid);
  shade.addColorStop(1, colors.light);
  ctx.fillStyle = shade;
  ctx.fill();

  const lamp = ctx.createRadialGradient(-width * 0.18, -length * 0.3, length * 0.05, 0, -length * 0.42, length * 0.9);
  lamp.addColorStop(0, colors.gleam);
  lamp.addColorStop(0.5, "hsla(45, 80%, 70%, 0)");
  ctx.fillStyle = lamp;
  ctx.fill();

  if (vein === "fan") paintDichotomousVeins(ctx, length, width, colors);
  else if (vein === "palmate") paintPalmateVeins(ctx, length, colors);
  else paintPinnateVeins(ctx, length, width, colors, vein === "crasp" ? "crasp" : "broch");
  ctx.restore();

  pathFn();
  ctx.strokeStyle = colors.gilt;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 0.35;
  ctx.stroke();
  ctx.restore();
}

function tilt(ctx, random, amount = 0.1) {
  ctx.rotate((random() - 0.5) * amount);
}

function drawBay(ctx, open, random) {
  const length = (18.5 + random() * 2.2) * open;
  const width = length * 0.34;
  const colors = mapleAutumnPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => bayPath(ctx, length, width), colors, length, width);
  ctx.restore();
}

function drawOlive(ctx, open, random) {
  const length = (17 + random() * 2) * open;
  const width = length * 0.2;
  const colors = mapleAutumnPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => olivePath(ctx, length, width), colors, length, width);
  ctx.restore();
}

function drawWillow(ctx, open, random) {
  const length = (22 + random() * 3) * open;
  const width = length * 0.145;
  const colors = mapleAutumnPalette(random);
  ctx.save();
  tilt(ctx, random, 0.16);
  paintModeledLeaf(ctx, () => willowPath(ctx, length, width), colors, length, width, "crasp");
  ctx.restore();
}

function drawOak(ctx, open, random) {
  const length = (19 + random() * 2.4) * open;
  const width = length * 0.46;
  const colors = mapleAutumnPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => oakPath(ctx, length, width), colors, length, width, "crasp");
  ctx.restore();
}

function drawHolly(ctx, open, random) {
  const length = (17.5 + random() * 2) * open;
  const width = length * 0.4;
  const colors = mapleAutumnPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => hollyPath(ctx, length, width), colors, length, width, "crasp");
  ctx.restore();
}

function drawIvy(ctx, open, random) {
  const size = (16.5 + random() * 2) * open;
  const colors = mapleAutumnPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => ivyPath(ctx, size), colors, size, size * 0.7, "palmate");
  ctx.restore();
}

function drawMaple(ctx, open, random, simple = false) {
  const size = (16.8 + random() * 2.4) * open;
  const colors = mapleAutumnPalette(random);
  ctx.save();
  tilt(ctx, random, 0.12);
  if (simple) {
    maplePath(ctx, size);
    ctx.fillStyle = colors.body;
    ctx.fill();
    maplePath(ctx, size);
    ctx.strokeStyle = colors.gilt;
    ctx.lineWidth = 0.35;
    ctx.stroke();
  } else {
    paintModeledLeaf(ctx, () => maplePath(ctx, size), colors, size, size * 0.78, "palmate");
  }
  ctx.restore();
}

function drawFig(ctx, open, random) {
  const size = (17 + random() * 2) * open;
  const colors = mapleAutumnPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => figPath(ctx, size), colors, size, size * 0.62, "palmate");
  ctx.restore();
}

function drawHawthorn(ctx, open, random) {
  const size = (16.5 + random() * 2) * open;
  const colors = mapleAutumnPalette(random);
  ctx.save();
  tilt(ctx, random);
  paintModeledLeaf(ctx, () => hawthornPath(ctx, size), colors, size, size * 0.55, "crasp");
  ctx.restore();
}

function drawGinkgo(ctx, open, random) {
  const radius = (14.5 + random() * 2) * open;
  const colors = mapleAutumnPalette(random);
  ctx.save();
  tilt(ctx, random, 0.08);
  paintModeledLeaf(ctx, () => ginkgoPath(ctx, radius), colors, radius, radius * 0.85, "fan");
  ctx.restore();
}

function drawRoseSprig(ctx, open, random) {
  const colors = mapleAutumnPalette(random);
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

function paintSpecimen(ctx, pathFn, fill, edge) {
  ctx.save();
  pathFn();
  ctx.fillStyle = fill;
  ctx.fill();
  pathFn();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.35;
  ctx.stroke();
  ctx.restore();
}

function drawLeafCrescent(ctx, open) {
  const s = 5.2 * open;
  ctx.save();
  paintSpecimen(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(s * 0.9, -s * 0.15, s * 1.05, -s * 0.75, 0, -s);
    ctx.bezierCurveTo(s * 0.28, -s * 0.62, s * 0.18, -s * 0.22, 0, 0);
    ctx.closePath();
  }, "#1e3d24", "#142616");
  ctx.restore();
}

function drawLeafTeardrop(ctx, open) {
  const s = 7.4 * open;
  ctx.save();
  paintSpecimen(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(s * 0.38, -s * 0.08, s * 0.42, -s * 0.55, 0, -s);
    ctx.bezierCurveTo(-s * 0.42, -s * 0.55, -s * 0.38, -s * 0.08, 0, 0);
    ctx.closePath();
  }, "#8a9a4a", "#5c6828");
  ctx.restore();
}

function drawLeafSageRound(ctx, open) {
  const s = 6.8 * open;
  ctx.save();
  paintSpecimen(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.08);
    ctx.bezierCurveTo(s * 0.62, s * 0.02, s * 0.7, -s * 0.55, 0, -s * 0.95);
    ctx.bezierCurveTo(-s * 0.7, -s * 0.55, -s * 0.62, s * 0.02, 0, s * 0.08);
    ctx.closePath();
  }, "#9aa394", "#6e766c");
  ctx.restore();
}

function drawLeafSerrate(ctx, open) {
  const s = 8.2 * open;
  ctx.save();
  paintSpecimen(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const teeth = 6;
    for (let i = 0; i <= teeth; i += 1) {
      const t = i / teeth;
      const y = -s * t;
      const w = s * 0.28 * Math.sin(Math.PI * t);
      ctx.lineTo(w * (i % 2 ? 1.18 : 0.72), y);
    }
    for (let i = teeth; i >= 0; i -= 1) {
      const t = i / teeth;
      const y = -s * t;
      const w = s * 0.28 * Math.sin(Math.PI * t);
      ctx.lineTo(-w * (i % 2 ? 1.18 : 0.72), y);
    }
    ctx.closePath();
  }, "#2d4a32", "#1a2e1e");
  ctx.restore();
}

function drawLeafNarrow(ctx, open) {
  const s = 7.6 * open;
  ctx.save();
  paintSpecimen(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(s * 0.2, -s * 0.12, s * 0.22, -s * 0.7, 0, -s);
    ctx.bezierCurveTo(-s * 0.22, -s * 0.7, -s * 0.2, -s * 0.12, 0, 0);
    ctx.closePath();
  }, "#2a4530", "#173022");
  ctx.restore();
}

function drawLeafWedge(ctx, open) {
  const s = 8.6 * open;
  ctx.save();
  paintSpecimen(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 0.42, -s * 0.22);
    ctx.quadraticCurveTo(s * 0.12, -s * 0.62, 0, -s);
    ctx.quadraticCurveTo(-s * 0.12, -s * 0.62, -s * 0.42, -s * 0.22);
    ctx.closePath();
  }, "#c8c8b8", "#9a9a8c");
  ctx.restore();
}

function drawLeafNeedle(ctx, open) {
  const s = 14.5 * open;
  ctx.save();
  ctx.strokeStyle = "#a89068";
  ctx.lineWidth = 0.85;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(s * 0.06, -s * 0.45, 0, -s);
  ctx.stroke();
  ctx.restore();
}

function drawLeafOlive(ctx, open) {
  const s = 9.6 * open;
  ctx.save();
  paintSpecimen(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(s * 0.32, -s * 0.06, s * 0.36, -s * 0.62, 0, -s);
    ctx.bezierCurveTo(-s * 0.36, -s * 0.62, -s * 0.32, -s * 0.06, 0, 0);
    ctx.closePath();
  }, "#6a7054", "#454a36");
  ctx.restore();
}

const FLOWER_TYPES = [
  drawLeafCrescent,
  drawLeafTeardrop,
  drawLeafSageRound,
  drawLeafSerrate,
  drawLeafNarrow,
  drawLeafWedge,
  drawLeafNeedle,
  drawLeafOlive,
];

function drawLeaf(ctx, scale, side, seed) {
  if (scale < 0.4) return;
  ctx.save();
  ctx.scale(side, 1);
  const type = FLOWER_TYPES[seed % FLOWER_TYPES.length];
  type(ctx, 0.42 * scale, mulberry32(seed));
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
  ctx.strokeStyle = "hsla(32, 16%, 28%, 0.55)";
  ctx.lineWidth = 0.8;
  ctx.stroke();

  const sideLeaves = [
    { at: 0.16, side: 1, scale: 0.7, rot: 1.08 },
    { at: 0.3, side: -1, scale: 0.76, rot: -1.02 },
    { at: 0.44, side: 1, scale: 0.8, rot: 1.12 },
    { at: 0.58, side: -1, scale: 0.74, rot: -0.98 },
    { at: 0.72, side: 1, scale: 0.68, rot: 0.94 },
    { at: 0.86, side: -1, scale: 0.62, rot: -0.9 },
  ];
  sideLeaves.forEach((leaf) => {
    if (stem < leaf.at) return;
    const a = pointOnPath(pts, leaf.at * stem);
    const tan = tangentOnPath(pts, leaf.at * stem);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(Math.atan2(tan.y, tan.x) + leaf.rot);
    drawLeaf(ctx, stem * leaf.scale, leaf.side, seed);
    ctx.restore();
  });

  ctx.restore();
}

function drawBloomAt(ctx, pts, bloom, stem, seed, scale) {
  const random = mulberry32(seed);
  const type = FLOWER_TYPES[seed % FLOWER_TYPES.length];
  const fade = easeOutCubic(Math.max(bloom, stem * 0.55));
  const open = easeOutCubic(Math.min(1, bloom)) * scale;
  const tipT = Math.max(0.12, easeInOut(stem));
  const tip = pointOnPath(pts, tipT);
  const tan = tangentOnPath(pts, tipT);

  ctx.save();
  ctx.globalAlpha = Math.max(0.45, fade);
  drawFlowStem(ctx, pts, stem, seed);
  ctx.restore();
  if (bloom > 0.12) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.translate(tip.x, tip.y);
    ctx.rotate(Math.atan2(tan.y, tan.x) + Math.PI / 2);
    type(ctx, open, random);
    ctx.restore();
  }
}

function evictBloom() {
  let worstKey = null;
  let worst = -1;
  for (const [key, existing] of blooms) {
    const away = Math.hypot(existing.x - mouse.x, existing.y - mouse.y);
    const score = away + (existing.bloom >= 0.95 ? 90 : 0) + (existing.leftAt ? 40 : 0);
    if (score > worst) {
      worst = score;
      worstKey = key;
    }
  }
  if (worstKey) blooms.delete(worstKey);
}

function updateHoverBlooms(now) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const originX = gridOrigin(GRID, width);
  const originY = gridOrigin(GRID, height);
  const active = new Set();

  if (mouse.inside) {
    if (now - lastPlantAt > 26) {
      lastPlantAt = now;
      const plantCount = 3;
      for (let i = 0; i < plantCount; i += 1) {
        if (blooms.size >= MAX_BLOOMS) evictBloom();
        const angle = Math.random() * Math.PI * 2;
        const reach = Math.sqrt(Math.random()) * BLOOM_RADIUS;
        const x = mouse.x + Math.cos(angle) * reach;
        const y = mouse.y + Math.sin(angle) * reach;
        const key = `p${bloomSeq}`;
        bloomSeq += 1;
        blooms.set(key, {
          x,
          y,
          seed: hash((x * 17) | 0, (y * 19) | 0) ^ bloomSeq,
          revealedAt: now,
          bloom: 0,
          stem: 0,
          leftAt: 0,
          dist: reach,
        });
      }
    }

    for (const [key, node] of blooms) {
      const dist = Math.hypot(node.x - mouse.x, node.y - mouse.y);
      if (dist > BLOOM_RADIUS * 1.15) continue;
      active.add(key);
      node.leftAt = 0;
      const wait = BLOOM_DELAY + ((node.dist || dist) / BLOOM_RADIUS) * SPRAWL_STAGGER * 0.45;
      const elapsed = now - node.revealedAt;
      if (elapsed > wait - STEM_LEAD) node.stem = Math.min(1, node.stem + growthRate(node.stem) * 1.2);
      if (elapsed > wait) node.bloom = Math.min(1, node.bloom + growthRate(node.bloom));
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
      ctx.fillStyle = `rgba(220, 220, 224, ${0.16 + intensity * 0.5})`;
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
  const lit = world.lit;
  const moonA = { x: width * 0.74, y: height * 0.13, r: 34 };
  const moonB = { x: width * 0.83, y: height * 0.2, r: 16 };
  const glowA = ctx.createRadialGradient(moonA.x, moonA.y, 0, moonA.x, moonA.y, moonA.r * 2.6);
  glowA.addColorStop(0, lit ? "rgba(255, 214, 130, 0.34)" : "rgba(214, 214, 218, 0.16)");
  glowA.addColorStop(0.42, lit ? "rgba(255, 160, 70, 0.12)" : "rgba(186, 186, 190, 0.05)");
  glowA.addColorStop(1, lit ? "rgba(255, 140, 50, 0)" : "rgba(186, 186, 190, 0)");
  ctx.fillStyle = glowA;
  ctx.fillRect(moonA.x - moonA.r * 2.6, moonA.y - moonA.r * 2.6, moonA.r * 5.2, moonA.r * 5.2);
  ctx.beginPath();
  ctx.fillStyle = lit ? "rgba(255, 228, 170, 0.72)" : "rgba(220, 220, 224, 0.24)";
  ctx.arc(moonA.x, moonA.y, 6.8, 0, Math.PI * 2);
  ctx.fill();

  const glowB = ctx.createRadialGradient(moonB.x, moonB.y, 0, moonB.x, moonB.y, moonB.r * 2.2);
  glowB.addColorStop(0, lit ? "rgba(255, 190, 110, 0.28)" : "rgba(196, 196, 200, 0.12)");
  glowB.addColorStop(1, lit ? "rgba(255, 150, 70, 0)" : "rgba(196, 196, 200, 0)");
  ctx.fillStyle = glowB;
  ctx.fillRect(moonB.x - moonB.r * 2.2, moonB.y - moonB.r * 2.2, moonB.r * 4.4, moonB.r * 4.4);
  ctx.beginPath();
  ctx.fillStyle = lit ? "rgba(255, 210, 150, 0.55)" : "rgba(200, 200, 204, 0.18)";
  ctx.arc(moonB.x, moonB.y, 3.2, 0, Math.PI * 2);
  ctx.fill();

  const stars = mulberry32(2024);
  for (let i = 0; i < 70; i += 1) {
    const x = stars() * width;
    const y = stars() * height * 0.4;
    const twinkle = 0.6 + 0.4 * Math.sin(now * 0.00045 + i * 1.7);
    ctx.fillStyle = lit
      ? `rgba(255, 226, 170, ${(0.1 + stars() * 0.22) * twinkle})`
      : `rgba(220, 220, 224, ${(0.07 + stars() * 0.18) * twinkle})`;
    ctx.fillRect(x, y, 0.8, 0.8);
  }

  const layers = lit
    ? [
        { fill: "rgba(168, 86, 32, 0.36)", shade: "rgba(70, 22, 8, 0.3)", light: "rgba(255, 196, 96, 0.18)" },
        { fill: "rgba(186, 98, 36, 0.46)", shade: "rgba(78, 26, 10, 0.32)", light: "rgba(255, 186, 88, 0.2)" },
        { fill: "rgba(204, 112, 40, 0.58)", shade: "rgba(82, 28, 10, 0.36)", light: "rgba(255, 206, 120, 0.22)" },
        { fill: "rgba(160, 78, 28, 0.72)", shade: "rgba(56, 18, 8, 0.4)", light: "rgba(255, 176, 80, 0.18)" },
        { fill: "rgba(110, 48, 16, 0.84)", shade: "rgba(36, 10, 6, 0.38)", light: "rgba(230, 140, 60, 0.16)" },
      ]
    : [
        { fill: "rgba(36, 36, 38, 0.28)", shade: "rgba(12, 12, 14, 0.2)", light: "rgba(168, 168, 172, 0.07)" },
        { fill: "rgba(44, 44, 46, 0.38)", shade: "rgba(16, 16, 18, 0.24)", light: "rgba(176, 176, 180, 0.08)" },
        { fill: "rgba(50, 50, 52, 0.5)", shade: "rgba(18, 18, 20, 0.28)", light: "rgba(186, 186, 190, 0.1)" },
        { fill: "rgba(40, 40, 42, 0.62)", shade: "rgba(12, 12, 14, 0.32)", light: "rgba(190, 190, 194, 0.1)" },
        { fill: "rgba(28, 28, 30, 0.74)", shade: "rgba(8, 8, 10, 0.28)", light: "rgba(160, 160, 164, 0.09)" },
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
      ctx.strokeStyle = lit ? "rgba(210, 120, 48, 0.16)" : "rgba(150, 150, 154, 0.1)";
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 34; i += 1) {
        const y0 = height * (0.48 + layer * 0.05) + i * 4.2;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 8) {
          const y = y0 + Math.sin(x * 0.034 + layer * 1.4 + i * 0.35) * 2.1 + noise3(x * 0.016, i * 0.18, layer) * 3.6;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.strokeStyle = lit ? "rgba(170, 86, 28, 0.1)" : "rgba(120, 120, 124, 0.07)";
      ctx.lineWidth = 0.4;
      for (let i = 0; i < 18; i += 1) {
        const x0 = (i / 18) * width;
        ctx.beginPath();
        for (let k = 0; k < 22; k += 1) {
          const x = x0 + k * 6;
          const y = duneHeight(x, width, height, layer) + 10 + i * 2.4 + noise3(x * 0.03, i * 0.4, layer) * 5;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(0, duneHeight(0, width, height, layer));
      for (let x = 8; x <= width; x += 8) {
        ctx.lineTo(x, duneHeight(x, width, height, layer));
      }
      ctx.strokeStyle = lit ? "rgba(255, 196, 110, 0.28)" : "rgba(198, 198, 202, 0.14)";
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    ctx.restore();
  });

  const haze = ctx.createLinearGradient(0, height * 0.36, 0, height * 0.52);
  haze.addColorStop(0, lit ? "rgba(80, 24, 8, 0)" : "rgba(12, 12, 14, 0)");
  haze.addColorStop(0.5, lit ? "rgba(230, 130, 48, 0.22)" : "rgba(72, 72, 76, 0.1)");
  haze.addColorStop(1, lit ? "rgba(80, 24, 8, 0)" : "rgba(12, 12, 14, 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, height * 0.36, width, height * 0.16);

  if (lit) {
    const flame = torchAnchor();
    const wash = ctx.createRadialGradient(flame.x, flame.y, 10, flame.x, flame.y, Math.max(width, height) * 0.72);
    wash.addColorStop(0, "rgba(255, 176, 64, 0.26)");
    wash.addColorStop(0.22, "rgba(220, 90, 24, 0.1)");
    wash.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);
  }

  const grit = mulberry32(77);
  for (let i = 0; i < 420; i += 1) {
    const x = grit() * width;
    const y = height * (0.46 + grit() * 0.52);
    ctx.fillStyle = lit
      ? `rgba(232, 164, 72, ${0.05 + grit() * 0.14})`
      : `rgba(186, 186, 190, ${0.035 + grit() * 0.1})`;
    ctx.fillRect(x, y, 1 + grit() * 2.2, 0.6 + grit());
  }
  for (let i = 0; i < 18; i += 1) {
    const x = grit() * width;
    const y = height * (0.62 + grit() * 0.32);
    ctx.fillStyle = `rgba(10, 10, 12, ${0.18 + grit() * 0.28})`;
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
      ctx.strokeStyle = world.lit
        ? `rgba(255, 186, 92, ${0.04 + fade * 0.16})`
        : `rgba(210, 210, 216, ${0.02 + fade * 0.1})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + GRID, y);
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + GRID);
      ctx.stroke();
    }
  }
  ctx.restore();
  drawEmergedHill(ctx, width, height, now, originX, originY);
}

function drawEmergedHill(ctx, width, height, now, originX, originY) {
  const layer = 2;
  const next = 3;
  const x0 = width * 0.56;
  const x1 = width * 0.9;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, height);
  ctx.lineTo(x0, duneHeight(x0, width, height, layer));
  for (let x = x0; x <= x1; x += 8) {
    ctx.lineTo(x, duneHeight(x, width, height, layer));
  }
  ctx.lineTo(x1, height);
  ctx.closePath();
  ctx.clip();

  ctx.beginPath();
  ctx.moveTo(x0, duneHeight(x0, width, height, next));
  for (let x = x0; x <= x1; x += 8) {
    ctx.lineTo(x, duneHeight(x, width, height, next));
  }
  ctx.lineTo(x1, height);
  ctx.lineTo(x0, height);
  ctx.closePath();
  ctx.clip();

  const pulse = 0.72 + 0.28 * Math.sin(now * 0.00035);
  ctx.lineWidth = 0.85;
  for (let x = originX; x <= width; x += GRID) {
    if (x < x0 - GRID || x > x1 + GRID) continue;
    for (let y = originY; y <= height; y += GRID) {
      const crest = duneHeight(x, width, height, layer);
      const foot = duneHeight(x, width, height, next);
      if (y < crest - 4 || y > foot + 10) continue;
      const edge = Math.min((x - x0) / (width * 0.08), (x1 - x) / (width * 0.08), 1);
      const alpha = 0.1 + pulse * 0.22 * Math.max(0, edge);
      ctx.strokeStyle = world.lit ? `rgba(255, 206, 120, ${alpha + 0.08})` : `rgba(228, 228, 234, ${alpha})`;
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
    const roll = Math.random();
    const rust = roll < 0.35;
    const umber = roll >= 0.35 && roll < 0.78;
    dust.push({
      x: x + (Math.random() - 0.5) * 7,
      y: y + 2 + (Math.random() - 0.4) * 5,
      vx: (Math.random() - 0.5) * 0.32,
      vy: 0.02 + Math.random() * 0.08,
      life: 1,
      decay: 0.001 + Math.random() * 0.0016,
      r: 0.45 + Math.random() * 1.35,
      hue: rust ? 8 + Math.random() * 10 : umber ? 16 + Math.random() * 10 : 12 + Math.random() * 8,
      sat: rust ? 74 + Math.random() * 16 : 68 + Math.random() * 16,
      light: rust ? 30 + Math.random() * 12 : umber ? 26 + Math.random() * 12 : 34 + Math.random() * 10,
    });
  }
}

function updateDust() {
  if (world.lit && Math.random() < 0.4) {
    const flame = torchAnchor();
    spawnDust(flame.x + (Math.random() - 0.5) * 12, flame.y + (Math.random() - 0.5) * 10, 1);
  }
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
    ctx.fillStyle = `hsla(${grain.hue}, ${grain.sat}%, ${grain.light}%, ${grain.life * 0.9})`;
    ctx.arc(grain.x, grain.y, grain.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTorchFlame(ctx, now) {
  const p = torchAnchor();
  if (p.x < 2) return;
  const glowPulse = 0.92 + 0.08 * Math.sin(now * 0.006);
  const h = 112;
  const envelope = (t) => Math.sin(Math.PI * Math.pow(Math.max(0, Math.min(1, t)), 0.62)) * 16.5;

  ctx.save();
  ctx.translate(p.x, p.y);

  const glow = ctx.createRadialGradient(0, -h * 0.34, 2, 0, -h * 0.4, h * 0.72);
  glow.addColorStop(0, world.lit ? `rgba(255, 196, 110, ${0.28 * glowPulse})` : `rgba(232, 232, 238, ${0.18 * glowPulse})`);
  glow.addColorStop(0.5, world.lit ? `rgba(255, 140, 50, ${0.08 * glowPulse})` : `rgba(210, 210, 216, ${0.05 * glowPulse})`);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.4, 16, h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const strand of [-1, 1]) {
    ctx.beginPath();
    for (let i = 0; i <= 56; i += 1) {
      const t = i / 56;
      const y = -t * h;
      const x = strand * Math.sin(t * Math.PI * 5.6) * envelope(t);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = 0.82;
    ctx.strokeStyle = world.lit ? "rgba(255, 220, 160, 0.92)" : "rgba(230, 230, 236, 0.88)";
    ctx.lineWidth = 1.7 - strand * 0.15;
    ctx.stroke();
  }

  ctx.lineWidth = 0.65;
  for (let i = 1; i < 14; i += 1) {
    const t = i / 14;
    const y = -t * h;
    const w = Math.sin(t * Math.PI * 5.6) * envelope(t);
    if (Math.abs(w) < 0.6) continue;
    ctx.globalAlpha = 0.22 + 0.2 * (1 - t);
    ctx.strokeStyle = world.lit ? "rgba(255, 186, 96, 0.85)" : "rgba(214, 214, 220, 0.7)";
    ctx.beginPath();
    ctx.moveTo(-w, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.4;
  ctx.fillStyle = world.lit ? "rgba(255, 230, 180, 0.9)" : "rgba(240, 240, 244, 0.85)";
  ctx.beginPath();
  ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCursor(ctx) {
  if (!mouse.inside) return;
  ctx.beginPath();
  ctx.strokeStyle = "rgba(214, 214, 218, 0.42)";
  ctx.lineWidth = 1;
  ctx.arc(mouse.x, mouse.y, 3.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = "rgba(210, 210, 214, 0.88)";
  ctx.arc(mouse.x, mouse.y, 1.05, 0, Math.PI * 2);
  ctx.fill();
}

const dropAnchors = [
  { el: "drop", ox: 0.14, oy: 0.14, scale: 0.62 },
  { el: "drop", ox: 0.36, oy: 0.12, scale: 0.7 },
  { el: "drop", ox: 0.58, oy: 0.2, scale: 0.6 },
  { el: "drop", ox: 0.24, oy: 0.4, scale: 0.58 },
  { el: "drop", ox: 0.48, oy: 0.46, scale: 0.64 },
  { el: "drop", ox: 0.12, oy: 0.64, scale: 0.52 },
  { el: "drop", ox: 0.4, oy: 0.72, scale: 0.5 },
  { el: "drop", ox: 0.66, oy: 0.8, scale: 0.48 },
  { el: "rest", ox: 0.05, oy: 0.22, scale: 0.5 },
  { el: "rest", ox: 0.16, oy: 0.68, scale: 0.46 },
  { el: "rest", ox: 0.28, oy: 0.18, scale: 0.52 },
  { el: "rest", ox: 0.4, oy: 0.76, scale: 0.48 },
  { el: "rest", ox: 0.52, oy: 0.28, scale: 0.5 },
  { el: "rest", ox: 0.64, oy: 0.7, scale: 0.46 },
  { el: "rest", ox: 0.76, oy: 0.2, scale: 0.5 },
  { el: "rest", ox: 0.88, oy: 0.64, scale: 0.46 },
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
  dropAnchors.forEach((anchor, index) => {
    const el = anchor.el === "rest" ? restLetter : dropLetter;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.width < 8) return;
    const sx = box.left + box.width * anchor.ox;
    const sy = box.top + box.height * anchor.oy;
    const seed = hash(index + 11, 97);
    const pts = integrateStream(sx, sy, seed, now * 0.18, 40, 0.5);
    const breathe = 0.76 + Math.sin(now * 0.000045 + index) * 0.035;
    drawBloomAt(ctx, pts, breathe, 0.86 + Math.sin(now * 0.000028 + index * 0.6) * 0.025, seed, anchor.scale);
  });
}

function drawDuneSprigs(ctx, width, height) {
  const rng = mulberry32(404);
  for (let i = 0; i < 78; i += 1) {
    const x = rng() * width;
    const layer = 2 + (i % 3);
    const y = duneHeight(x, width, height, layer) + 6 + rng() * 36;
    ctx.save();
    ctx.globalAlpha = 0.55 + rng() * 0.3;
    ctx.translate(x, y);
    ctx.rotate((rng() - 0.5) * 0.7);
    FLOWER_TYPES[i % FLOWER_TYPES.length](ctx, 0.52 + rng() * 0.4, rng);
    ctx.restore();
  }
}

function frame(now) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  fieldCtx.clearRect(0, 0, width, height);
  illumCtx.clearRect(0, 0, width, height);

  drawArrakis(fieldCtx, width, height, now);
  drawDuneSprigs(fieldCtx, width, height);
  drawDuneMatrix(fieldCtx, width, height, now);
  updatePointerField(now);
  updateStuckGrid(now);
  const { originX, originY } = updateHoverBlooms(now);
  drawStuckGrid(fieldCtx);
  drawGrid(fieldCtx, now);
  drawHoverNodes(fieldCtx, originX, originY, now);

  for (const node of blooms.values()) {
    if (node.stem < 0.01 && node.bloom < 0.01) continue;
    if (!node.pts) node.pts = integrateStream(node.x, node.y, node.seed, (node.seed % 997) + 40, 96, 1.08);
    drawBloomAt(illumCtx, node.pts, node.bloom, node.stem, node.seed, 1.45);
  }

  updateDust();
  drawDust(fieldCtx);
  drawCursor(fieldCtx);
  drawDropcap(illumCtx, now);
  drawTorchFlame(illumCtx, now);
  requestAnimationFrame(frame);
}

resize();
requestAnimationFrame(frame);
