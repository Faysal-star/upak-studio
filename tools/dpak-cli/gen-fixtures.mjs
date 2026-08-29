// Generates the deterministic golden fixture pack (no PNGs, no timestamps, no randomness).
// Outputs: fixtures/golden_v1.dpak, fixtures/golden_v1.json,
//          ../../firmware/test/test_dpak/fixtures_golden.h
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fnv1a } from "./fnv.mjs";
import { buildPack, spriteBlob, animBlob, exprBlob, paletteBlob, emitCHeader, TYPE, FMT, COMP, LOOP } from "./dpakw.mjs";
import { parsePack, decodeSprite, getById } from "./dpakr.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK_ID = 0x0123456789abcdefn;
const W = 32, H = 32;

// Sprite 1 payload: RGB565 gradient (deterministic)
const grad = Buffer.alloc(W * H * 2);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const r5 = Math.floor((x / (W - 1)) * 31);
    const g6 = Math.floor((y / (H - 1)) * 63);
    const b5 = 31 - r5;
    grad.writeUInt16LE((r5 << 11) | (g6 << 5) | b5, (y * W + x) * 2);
  }
}

// Sprite 2 payload: RGB565_A1 filled circle (color plane + A1 mask plane)
const circColor = Buffer.alloc(W * H * 2);
const rowBytes = Math.ceil(W / 8);
const circMask = Buffer.alloc(rowBytes * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = x - 15.5, dy = y - 15.5;
    const inside = dx * dx + dy * dy <= 14 * 14;
    circColor.writeUInt16LE(inside ? 0xfd20 : 0x0000, (y * W + x) * 2); // orange inside
    if (inside) circMask[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  }
}

// Sprite 3 payload: PAL8 checkerboard, 8px cells, indices 1..3 (index 0 = transparent by spec)
const checker = Buffer.alloc(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    checker[y * W + x] = 1 + (((x >> 3) + (y >> 3)) % 3);
  }
}
const paletteColors = [0x0000 /* slot 0 transparent */, 0xf800, 0x07e0, 0x001f];

const assets = [
  { id: 1, type: TYPE.PALETTE, name: "pal4", blob: paletteBlob({ colors: paletteColors }) },
  { id: 2, type: TYPE.SPRITE, name: "grad32", blob: spriteBlob({ width: W, height: H, format: FMT.RGB565, compression: COMP.LZ4_BLOCK, planes: grad }) },
  { id: 3, type: TYPE.SPRITE, name: "circle32", blob: spriteBlob({ width: W, height: H, format: FMT.RGB565_A1, compression: COMP.LZ4_BLOCK, planes: Buffer.concat([circColor, circMask]) }) },
  { id: 4, type: TYPE.SPRITE, name: "checker32", blob: spriteBlob({ width: W, height: H, format: FMT.PAL8, compression: COMP.NONE, paletteRef: 1, planes: checker }) },
  {
    id: 5, type: TYPE.ANIM, name: "spin",
    blob: animBlob({
      loopMode: LOOP.loop,
      defaultFpsX10: 0, // per-frame durations
      frames: [
        { spriteId: 2, durationMs: 100 },
        { spriteId: 3, durationMs: 100 },
        { spriteId: 4, durationMs: 100 },
      ],
    }),
  },
  {
    id: 6, type: TYPE.EXPR, name: "blink",
    blob: exprBlob({
      tracks: [
        { paramId: 7, keys: [{ tMs: 0, value: 0, easing: 2 }, { tMs: 80, value: 256, easing: 2 }, { tMs: 160, value: 0, easing: 1 }] }, // lidTopL
        { paramId: 8, keys: [{ tMs: 0, value: 0, easing: 2 }, { tMs: 80, value: 256, easing: 2 }, { tMs: 160, value: 0, easing: 1 }] }, // lidTopR
      ],
    }),
  },
];

const pack = buildPack({ packId: PACK_ID, assets });
const parsed = parsePack(pack); // self-check: CRC + bounds

const spriteInfo = {};
for (const [name, id] of [["grad32", 2], ["circle32", 3], ["checker32", 4]]) {
  const px = decodeSprite(parsed, getById(parsed, id));
  spriteInfo[name] = { assetId: id, nameHash: fnv1a(name), rawSize: px.length, decodedFnv: fnv1a(px) };
}

fs.mkdirSync(path.join(HERE, "fixtures"), { recursive: true });
fs.writeFileSync(path.join(HERE, "fixtures", "golden_v1.dpak"), pack);
fs.writeFileSync(
  path.join(HERE, "fixtures", "golden_v1.json"),
  JSON.stringify({
    format: "DPAK v1",
    size: pack.length,
    crc32: `0x${parsed.crc.toString(16).padStart(8, "0")}`,
    packId: `0x${PACK_ID.toString(16).padStart(16, "0")}`,
    tocCount: parsed.tocCount,
    assets: parsed.toc.map((e) => ({
      assetId: e.assetId, type: e.type, nameHash: `0x${e.nameHash.toString(16).padStart(8, "0")}`, offset: e.offset, length: e.length,
    })),
    sprites: Object.fromEntries(Object.entries(spriteInfo).map(([k, v]) => [k, {
      ...v, nameHash: `0x${v.nameHash.toString(16).padStart(8, "0")}`, decodedFnv: `0x${v.decodedFnv.toString(16).padStart(8, "0")}`,
    }])),
    note: "decodedFnv = FNV-1a 32 over the decompressed payload bytes (concatenated pixel planes)",
  }, null, 2) + "\n",
);

const testDir = path.join(HERE, "..", "..", "firmware", "test", "test_dpak");
fs.mkdirSync(testDir, { recursive: true });
fs.writeFileSync(path.join(testDir, "fixtures_golden.h"), emitCHeader({
  pack,
  arrayName: "g_golden",
  guard: "FIXTURES_GOLDEN_H",
  constants: {
    GOLDEN_CRC32: parsed.crc,
    GOLDEN_PACKID: PACK_ID,
    GOLDEN_TOC_COUNT: parsed.tocCount,
    GOLDEN_GRAD32_HASH: spriteInfo.grad32.nameHash,
    GOLDEN_GRAD32_RAWSIZE: spriteInfo.grad32.rawSize,
    GOLDEN_GRAD32_FNV: spriteInfo.grad32.decodedFnv,
    GOLDEN_CIRCLE32_HASH: spriteInfo.circle32.nameHash,
    GOLDEN_CIRCLE32_RAWSIZE: spriteInfo.circle32.rawSize,
    GOLDEN_CIRCLE32_FNV: spriteInfo.circle32.decodedFnv,
    GOLDEN_CHECKER32_HASH: spriteInfo.checker32.nameHash,
    GOLDEN_CHECKER32_RAWSIZE: spriteInfo.checker32.rawSize,
    GOLDEN_CHECKER32_FNV: spriteInfo.checker32.decodedFnv,
    GOLDEN_ANIM_HASH: fnv1a("spin"),
    GOLDEN_EXPR_HASH: fnv1a("blink"),
  },
}));

console.log(`golden_v1.dpak: ${pack.length} bytes, crc32=0x${parsed.crc.toString(16)}`);
for (const [k, v] of Object.entries(spriteInfo)) console.log(`  ${k}: raw=${v.rawSize} fnv=0x${v.decodedFnv.toString(16)}`);
console.log("wrote fixtures/golden_v1.dpak, fixtures/golden_v1.json, firmware/test/test_dpak/fixtures_golden.h");
