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
  const mix = random();
  if (mix < 0.38) {
    return {
      inner: `hsla(${40 + random() * 10}, ${68 + random() * 16}%, ${40 + random() * 12}%, 0.94)`,
      outer: `hsla(${48 + random() * 8}, ${74 + random() * 12}%, ${56 + random() * 12}%, 0.9)`,
      vein: "hsla(34, 42%, 28%, 0.55)",
    };
  }
  if (mix < 0.72) {
    return {
      inner: `hsla(${104 + random() * 18}, ${34 + random() * 16}%, ${24 + random() * 8}%, 0.93)`,
      outer: `hsla(${92 + random() * 16}, ${42 + random() * 14}%, ${38 + random() * 10}%, 0.9)`,
      vein: "hsla(96, 28%, 20%, 0.5)",
    };
  }
  return {
    inner: `hsla(${98 + random() * 12}, ${38 + random() * 12}%, ${28 + random() * 8}%, 0.93)`,
    outer: `hsla(${44 + random() * 10}, ${70 + random() * 12}%, ${52 + random() * 10}%, 0.9)`,
    vein: "hsla(40, 36%, 26%, 0.5)",
  };
}

function fillSimpleLeaf(ctx, length, width, colors) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(width, -length * 0.2, width * 1.08, -length * 0.62, 0, -length);
  ctx.bezierCurveTo(-width * 1.08, -length * 0.62, -width, -length * 0.2, 0, 0);
  ctx.closePath();
  const grad = ctx.createLinearGradient(-width * 0.4, 0, width * 0.6, -length);
  grad.addColorStop(0, colors.inner);
  grad.addColorStop(0.55, colors.outer);
  grad.addColorStop(1, colors.inner);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "rgba(36, 30, 16, 0.32)";
  ctx.lineWidth = 0.35;
  ctx.stroke();
}

function drawVeinsOnLeaf(ctx, length, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(0, -length * 0.52, 0, -length * 0.94);
  ctx.stroke();
  ctx.lineWidth = 0.32;
  for (let i = 1; i <= 5; i += 1) {
    const t = i / 6.2;
    const y = -length * t;
    const reach = width * (1 - t * 0.55) * 0.78;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.quadraticCurveTo(reach * 0.45, y - length * 0.05, reach, y - length * 0.09);
    ctx.moveTo(0, y);
    ctx.quadraticCurveTo(-reach * 0.45, y - length * 0.05, -reach, y - length * 0.09);
    ctx.stroke();
  }
}

function drawLaurel(ctx, open, random) {
  const length = (17.5 + random() * 4) * open;
  const width = (6.4 + random() * 1.4) * open;
  const colors = leafPalette(random);
  ctx.save();
  fillSimpleLeaf(ctx, length, width, colors);
  drawVeinsOnLeaf(ctx, length, width, colors.vein);
  ctx.restore();
}

function drawOak(ctx, open, random) {
  const length = (18 + random() * 3.5) * open;
  const width = (8.2 + random() * 1.6) * open;
  const colors = leafPalette(random);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let side of [1, -1]) {
    if (side === -1) ctx.lineTo(0, 0);
    for (let i = 1; i <= 4; i += 1) {
      const t = i / 5;
      const y = -length * t;
      const bulge = width * (0.42 + Math.sin(t * Math.PI) * 0.7);
      ctx.quadraticCurveTo(side * bulge, y + length * 0.05, side * bulge * 0.28, y);
      ctx.quadraticCurveTo(side * bulge * 1.08, y - length * 0.04, side * bulge * 0.22, y - length * 0.07);
    }
    ctx.quadraticCurveTo(side * width * 0.12, -length, 0, -length);
  }
  ctx.closePath();
  const grad = ctx.createLinearGradient(-width, 0, width, -length);
  grad.addColorStop(0, colors.inner);
  grad.addColorStop(0.5, colors.outer);
  grad.addColorStop(1, colors.inner);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "rgba(36, 30, 16, 0.32)";
  ctx.lineWidth = 0.35;
  ctx.stroke();
  drawVeinsOnLeaf(ctx, length, width * 0.7, colors.vein);
  ctx.restore();
}

function drawMaple(ctx, open, random) {
  const length = (16.5 + random() * 3) * open;
  const colors = leafPalette(random);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  const lobes = [
    [-0.95, -0.28, 0.55],
    [-0.55, -0.72, 0.82],
    [0, -1, 1],
    [0.55, -0.72, 0.82],
    [0.95, -0.28, 0.55],
  ];
  lobes.forEach((lobe, i) => {
    const x = lobe[0] * length * 0.72;
    const y = lobe[1] * length;
    const w = lobe[2] * 5.2 * open;
    if (i === 0) ctx.quadraticCurveTo(x * 0.4, y * 0.2, x - w * 0.2, y * 0.7);
    ctx.quadraticCurveTo(x + (i < 2 ? -w : w) * 0.15, y, x, y);
    ctx.quadraticCurveTo(x * 0.55, y * 0.72, 0, y * 0.35);
  });
  ctx.closePath();
  const grad = ctx.createLinearGradient(-length * 0.4, 0, length * 0.3, -length);
  grad.addColorStop(0, colors.inner);
  grad.addColorStop(0.6, colors.outer);
  grad.addColorStop(1, colors.inner);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "rgba(36, 30, 16, 0.32)";
  ctx.lineWidth = 0.35;
  ctx.stroke();
  ctx.strokeStyle = colors.vein;
  ctx.lineWidth = 0.45;
  lobes.forEach((lobe) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(lobe[0] * length * 0.25, lobe[1] * length * 0.45, lobe[0] * length * 0.62, lobe[1] * length * 0.92);
    ctx.stroke();
  });
  ctx.restore();
}

function drawGinkgo(ctx, open, random) {
  const radius = (13.5 + random() * 2.4) * open;
  const colors = leafPalette(random);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-radius * 0.15, -radius * 0.2, -radius * 1.05, -radius * 0.15, -radius, -radius * 0.72);
  ctx.quadraticCurveTo(-radius * 0.2, -radius * 1.12, 0, -radius * 0.78);
  ctx.quadraticCurveTo(radius * 0.2, -radius * 1.12, radius, -radius * 0.72);
  ctx.bezierCurveTo(radius * 1.05, -radius * 0.15, radius * 0.15, -radius * 0.2, 0, 0);
  ctx.closePath();
  const grad = ctx.createLinearGradient(-radius, 0, radius, -radius);
  grad.addColorStop(0, colors.inner);
  grad.addColorStop(0.5, colors.outer);
  grad.addColorStop(1, "hsla(46, 78%, 58%, 0.92)");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "rgba(36, 30, 16, 0.3)";
  ctx.lineWidth = 0.35;
  ctx.stroke();
  ctx.strokeStyle = colors.vein;
  ctx.lineWidth = 0.32;
  for (let i = -4; i <= 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(i * radius * 0.08, -radius * 0.4, i * radius * 0.18, -radius * 0.86);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWillow(ctx, open, random) {
  const length = (20 + random() * 4) * open;
  const width = (3.4 + random() * 0.8) * open;
  const colors = leafPalette(random);
  ctx.save();
  fillSimpleLeaf(ctx, length, width, colors);
  drawVeinsOnLeaf(ctx, length, width, colors.vein);
  ctx.restore();
}

function drawSpray(ctx, open, random) {
  const count = 5;
  ctx.save();
  for (let i = 0; i < count; i += 1) {
    ctx.save();
    ctx.rotate((-0.7 + i * 0.35) * open);
    ctx.translate(0, -2.2 * open);
    drawLaurel(ctx, open * (0.55 + (i % 2) * 0.18), random);
    ctx.restore();
  }
  ctx.restore();
}

const FLOWER_TYPES = [drawLaurel, drawOak, drawMaple, drawGinkgo, drawWillow, drawSpray, drawLaurel];

function drawLeaf(ctx, scale, side) {
  ctx.save();
  ctx.scale(side, 1);
  const grad = ctx.createLinearGradient(0, 0, 5 * scale, -6 * scale);
  grad.addColorStop(0, "hsla(102, 28%, 26%, 0.86)");
  grad.addColorStop(1, "hsla(44, 62%, 48%, 0.78)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(3.4 * scale, -1.2 * scale, 5.2 * scale, -4.2 * scale, 0.3 * scale, -6.8 * scale);
  ctx.bezierCurveTo(1.4 * scale, -3.6 * scale, 0.5 * scale, -1.6 * scale, 0, 0);
  ctx.fill();
  ctx.strokeStyle = "rgba(30, 24, 16, 0.35)";
  ctx.lineWidth = 0.28;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.2 * scale, 0);
  ctx.quadraticCurveTo(1.6 * scale, -2.6 * scale, 0.35 * scale, -6.2 * scale);
  ctx.stroke();
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
  ctx.strokeStyle = "hsla(105, 16%, 24%, 0.72)";
  ctx.lineWidth = 1.45;
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
    drawLaurel(ctx, stem * 0.72, random);
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
  ctx.strokeStyle = "rgba(141, 107, 50, 0.42)";
  ctx.lineWidth = 0.9;
  ctx.stroke();

  ctx.beginPath();
  for (let a = 0.4; a < Math.PI * 4.4; a += 0.06) {
    const r = scale * Math.pow(PHI, (2 * a) / Math.PI) * 0.055;
    const x = Math.cos(-a + now * 0.000012) * r;
    const y = Math.sin(-a + now * 0.000012) * r;
    if (a === 0.4) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(58, 42, 24, 0.28)";
  ctx.lineWidth = 0.65;
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
