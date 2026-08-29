// Generates firmware/data/demo.dpak — 240x240 8-frame bouncing ball with a face.
// Flat-shaded (no AA) so LZ4 keeps the pack small. Deterministic output.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fnv1a } from "./fnv.mjs";
import { buildPack, spriteBlob, animBlob, rgb888to565, TYPE, FMT, COMP, LOOP } from "./dpakw.mjs";
import { parsePack } from "./dpakr.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = 240, H = 240, FRAMES = 8;

function makeFrame(i) {
  const buf = Buffer.alloc(W * H * 2);
  const px = new Uint16Array(W * H);

  // Background: vertical gradient in 16px bands (compresses well)
  for (let y = 0; y < H; y++) {
    const band = y >> 4;
    const c = rgb888to565(18, 18 + band * 3, 40 + band * 6);
    px.fill(c, y * W, (y + 1) * W);
  }
  // Floor line
  for (let y = 214; y < 218; y++) px.fill(rgb888to565(60, 70, 110), y * W, (y + 1) * W);

  // Ball motion: parabolic bounce, one full bounce over 8 frames
  const t = i / FRAMES; // 0..1
  const bounce = Math.abs(Math.sin(Math.PI * t)); // 0 at impact, 1 at apex
  const r = 44;
  const cx = 120;
  const groundY = 214;
  const apexY = 70;
  const cy = groundY - r - bounce * (groundY - r - apexY);
  // Squash at impact (frames near t=0/1)
  const squash = 1 - 0.25 * (1 - bounce);
  const rx = Math.round(r / squash);
  const ry = Math.round(r * squash);

  const ballC = rgb888to565(255, 170, 40);
  const ballEdge = rgb888to565(200, 110, 20);
  const cyAdj = groundY - ry - bounce * (groundY - ry - apexY);
  for (let y = Math.max(0, Math.floor(cyAdj - ry)); y <= Math.min(H - 1, Math.ceil(cyAdj + ry)); y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const nx = (x - cx) / rx, ny = (y - cyAdj) / ry;
      const d = nx * nx + ny * ny;
      if (d <= 1) px[y * W + x] = d > 0.86 ? ballEdge : ballC;
    }
  }

  // Face: two eyes (blink on frame 5) + mouth
  const eyeC = rgb888to565(30, 25, 20);
  const eyeY = cyAdj - ry * 0.18;
  const blink = i === 5;
  for (const ex of [cx - rx * 0.32, cx + rx * 0.32]) {
    const ew = Math.round(rx * 0.13), eh = blink ? 2 : Math.round(ry * 0.2);
    for (let y = Math.round(eyeY - eh); y <= Math.round(eyeY + eh); y++) {
      for (let x = Math.round(ex - ew); x <= Math.round(ex + ew); x++) {
        const nx = (x - ex) / ew, ny = (y - eyeY) / eh;
        if (nx * nx + ny * ny <= 1) px[y * W + x] = eyeC;
      }
    }
  }
  // Smile: arc of the ellipse
  const mouthY = cyAdj + ry * 0.28;
  const mw = rx * 0.35;
  for (let x = Math.round(cx - mw); x <= Math.round(cx + mw); x++) {
    const nx = (x - cx) / mw;
    const y = Math.round(mouthY + (1 - nx * nx) * ry * 0.12);
    for (let yy = y; yy < y + 3; yy++) px[yy * W + x] = eyeC;
  }

  for (let p = 0; p < W * H; p++) buf.writeUInt16LE(px[p], p * 2);
  return buf;
}

const assets = [];
const frames = [];
for (let i = 0; i < FRAMES; i++) {
  assets.push({
    id: i + 1,
    type: TYPE.SPRITE,
    name: `demo_f${i}`,
    blob: spriteBlob({ width: W, height: H, format: FMT.RGB565, compression: COMP.LZ4_BLOCK, planes: makeFrame(i) }),
  });
  frames.push({ spriteId: i + 1, durationMs: 80 });
}
assets.push({
  id: FRAMES + 1,
  type: TYPE.ANIM,
  name: "demo",
  blob: animBlob({ frames, loopMode: LOOP.loop, defaultFpsX10: 125 }),
});

const pack = buildPack({ packId: 0xdec0de00de51c9e7n, assets });
parsePack(pack); // self-check
const outDir = path.join(HERE, "..", "..", "firmware", "data");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "demo.dpak");
fs.writeFileSync(out, pack);
console.log(`demo.dpak: ${pack.length} bytes (${(pack.length / 1024).toFixed(1)} KB), ${FRAMES} frames 240x240, anim 'demo' hash 0x${fnv1a("demo").toString(16)}`);
if (pack.length > 300 * 1024) console.warn("WARNING: pack exceeds 300KB target");
console.log(`wrote ${out}`);
