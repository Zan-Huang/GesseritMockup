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

function leafPalette(random) {
  if (random() < 0.42) {
    return {
      umber: "hsla(32, 62%, 18%, 0.78)",
      body: "hsla(38, 82%, 36%, 0.94)",
      mid: "hsla(42, 88%, 48%, 0.9)",
      light: "hsla(46, 96%, 64%, 0.72)",
      gleam: "hsla(48, 100%, 82%, 0.55)",
      vein: "hsla(30, 48%, 22%, 0.4)",
      gilt: "hsla(45, 100%, 72%, 0.7)",
    };
  }
  return {
    umber: "hsla(150, 40%, 8%, 0.82)",
    body: "hsla(152, 48%, 14%, 0.94)",
    mid: "hsla(148, 38%, 22%, 0.9)",
    light: "hsla(92, 28%, 34%, 0.55)",
    gleam: "hsla(46, 86%, 62%, 0.32)",
    vein: "hsla(42, 55%, 38%, 0.38)",
    gilt: "hsla(44, 90%, 58%, 0.55)",
  };
}

function ovalLeafPath(ctx, length, width, lean) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(width * 0.18, -length * 0.06, width + lean, -length * 0.3, width * 0.7 + lean, -length * 0.66);
  ctx.bezierCurveTo(width * 0.22 + lean * 0.4, -length * 1.02, -width * 0.08, -length, lean * 0.12, -length);
  ctx.bezierCurveTo(-width * 0.5 + lean, -length * 0.74, -width * 0.95, -length * 0.32, -width * 0.12, -length * 0.07);
  ctx.quadraticCurveTo(-width * 0.04, -length * 0.02, 0, 0);
  ctx.closePath();
}

function ivyLeafPath(ctx, size) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(size * 0.95, size * 0.12, size * 1.2, -size * 0.28, size * 0.42, -size * 0.68);
  ctx.quadraticCurveTo(size * 0.08, -size * 0.92, 0, -size);
  ctx.quadraticCurveTo(-size * 0.08, -size * 0.92, -size * 0.42, -size * 0.68);
  ctx.bezierCurveTo(-size * 1.2, -size * 0.28, -size * 0.95, size * 0.12, 0, 0);
  ctx.closePath();
}

function acanthusLobePath(ctx, length, width, flip) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(flip * width * 0.3, -length * 0.1, flip * width * 1.15, -length * 0.28, flip * width * 0.85, -length * 0.55);
  ctx.bezierCurveTo(flip * width * 1.05, -length * 0.78, flip * width * 0.25, -length * 0.95, 0, -length);
  ctx.bezierCurveTo(-flip * width * 0.15, -length * 0.7, -flip * width * 0.35, -length * 0.35, 0, 0);
  ctx.closePath();
}

function paintModeledLeaf(ctx, pathFn, colors, length, width) {
  ctx.save();
  pathFn();
  ctx.fillStyle = colors.umber;
  ctx.fill();

  ctx.save();
  pathFn();
  ctx.clip();
  const shade = ctx.createLinearGradient(-width, 0, width * 0.7, -length);
  shade.addColorStop(0, colors.umber);
  shade.addColorStop(0.32, colors.body);
  shade.addColorStop(0.62, colors.mid);
  shade.addColorStop(1, colors.light);
  ctx.fillStyle = shade;
  ctx.fill();

  const lamp = ctx.createRadialGradient(-width * 0.15, -length * 0.28, length * 0.04, 0, -length * 0.4, length * 0.85);
  lamp.addColorStop(0, colors.gleam);
  lamp.addColorStop(0.45, "hsla(45, 80%, 70%, 0)");
  lamp.addColorStop(1, "hsla(150, 20%, 10%, 0)");
  ctx.fillStyle = lamp;
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(-width * 0.12, -length * 0.34, width * 0.22, length * 0.18, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = colors.gleam;
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();

  pathFn();
  ctx.strokeStyle = colors.gilt;
  ctx.lineWidth = 0.55;
  ctx.stroke();

  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(width * 0.06, -length * 0.5, 0, -length * 0.92);
  ctx.strokeStyle = colors.vein;
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(width * 0.04, -length * 0.04);
  ctx.quadraticCurveTo(width * 0.1, -length * 0.48, width * 0.03, -length * 0.88);
  ctx.strokeStyle = colors.gilt;
  ctx.lineWidth = 0.28;
  ctx.globalAlpha = 0.35;
  ctx.stroke();
  ctx.globalAlpha = 1;

  for (let i = 1; i <= 4; i += 1) {
    const t = i / 5.2;
    const y = -length * t;
    const reach = width * (0.55 - t * 0.2);
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.quadraticCurveTo(reach * 0.4, y - length * 0.04, reach, y - length * 0.08);
    ctx.moveTo(0, y);
    ctx.quadraticCurveTo(-reach * 0.35, y - length * 0.03, -reach * 0.75, y - length * 0.05);
    ctx.strokeStyle = colors.vein;
    ctx.lineWidth = 0.28;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawBay(ctx, open, random) {
  const length = (18 + random() * 3.5) * open;
  const width = (6.2 + random() * 1.2) * open;
  const lean = (random() - 0.5) * width * 0.35;
  const colors = leafPalette(random);
  ctx.save();
  ctx.rotate((random() - 0.5) * 0.2);
  paintModeledLeaf(ctx, () => ovalLeafPath(ctx, length, width, lean), colors, length, width);
  ctx.restore();
}

function drawIvy(ctx, open, random) {
  const size = (16 + random() * 3) * open;
  const colors = leafPalette(random);
  ctx.save();
  ctx.rotate((random() - 0.5) * 0.25);
  paintModeledLeaf(ctx, () => ivyLeafPath(ctx, size), colors, size, size * 0.7);
  ctx.restore();
}

function drawAcanthus(ctx, open, random) {
  const colors = leafPalette(random);
  ctx.save();
  ctx.rotate((random() - 0.5) * 0.15);
  for (let i = 0; i < 3; i += 1) {
    ctx.save();
    ctx.rotate((-0.55 + i * 0.55) * 0.9);
    const length = (13 + i * 2.4) * open;
    const width = (5.4 + i * 0.6) * open;
    const flip = i === 2 ? -1 : 1;
    paintModeledLeaf(ctx, () => acanthusLobePath(ctx, length, width, flip), colors, length, width);
    ctx.restore();
  }
  ctx.restore();
}

function drawVineLeaf(ctx, open, random) {
  const length = (16 + random() * 2.8) * open;
  const colors = leafPalette(random);
  ctx.save();
  ctx.rotate((random() - 0.5) * 0.18);
  paintModeledLeaf(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(length * 0.55, -length * 0.05, length * 0.72, -length * 0.42, length * 0.22, -length * 0.58);
      ctx.bezierCurveTo(length * 0.35, -length * 0.82, length * 0.08, -length * 1.02, 0, -length);
      ctx.bezierCurveTo(-length * 0.08, -length * 1.02, -length * 0.35, -length * 0.82, -length * 0.22, -length * 0.58);
      ctx.bezierCurveTo(-length * 0.72, -length * 0.42, -length * 0.55, -length * 0.05, 0, 0);
      ctx.closePath();
    },
    colors,
    length,
    length * 0.55,
  );
  ctx.restore();
}

function drawSprig(ctx, open, random) {
  ctx.save();
  for (let i = 0; i < 4; i += 1) {
    ctx.save();
    ctx.rotate((-0.55 + i * 0.36) * open);
    ctx.translate(0, -1.6 * open);
    if (i % 2 === 0) drawBay(ctx, open * 0.62, random);
    else drawIvy(ctx, open * 0.55, random);
    ctx.restore();
  }
  ctx.restore();
}

const FLOWER_TYPES = [drawBay, drawIvy, drawAcanthus, drawVineLeaf, drawBay, drawSprig, drawIvy];

function drawLeaf(ctx, scale, side) {
  ctx.save();
  ctx.scale(side, 1);
  const colors = leafPalette(() => (side > 0 ? 0.7 : 0.2));
  paintModeledLeaf(
    ctx,
    () => ovalLeafPath(ctx, 7.2 * scale, 2.8 * scale, 0.4 * scale),
    colors,
    7.2 * scale,
    2.8 * scale,
  );
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
