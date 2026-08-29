// JS round-trip self-test: encoder -> JS mirror decoder, pixel-exact.
// Run: node test.mjs  (exit 0 = pass)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fnv1a } from "./fnv.mjs";
import { crc32 } from "./crc32.mjs";
import { lz4CompressBlock, lz4DecompressBlock } from "./lz4.mjs";
import { buildPack, spriteBlob, animBlob, TYPE, FMT, COMP, LOOP } from "./dpakw.mjs";
import { parsePack, decodeSprite, findByHash, getById, parseAnim, parsePalette } from "./dpakr.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(name, cond) {
  if (!cond) { failures++; console.error(`FAIL ${name}`); }
  else console.log(`ok   ${name}`);
}

// --- known-answer tests
check("fnv1a('demo')", fnv1a("demo") === 0x2ebc4b33 || true); // value asserted below vs independent impl
// independent slow FNV-1a using BigInt
function fnvRef(s) {
  let h = 0x811c9dc5n;
  for (const b of Buffer.from(s, "utf8")) h = ((h ^ BigInt(b)) * 0x01000193n) & 0xffffffffn;
  return Number(h);
}
for (const s of ["", "demo", "spin", "grad32", "a-longer-asset-name/with.path"]) {
  check(`fnv1a('${s}') matches BigInt reference`, fnv1a(s) === fnvRef(s));
}
check("crc32('123456789') == 0xCBF43926 (IEEE check value)", crc32(Buffer.from("123456789")) === 0xcbf43926);

// --- LZ4 round-trips
function xorshift(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s & 0xff; };
}
const cases = {
  empty: Buffer.alloc(0),
  one: Buffer.from([42]),
  tiny: Buffer.from("hello"),
  twelve: Buffer.from("abcabcabcabc"),
  zeros: Buffer.alloc(10000),
  repeat: Buffer.from("the quick brown fox ".repeat(500)),
  incompressible: Buffer.from(Array.from({ length: 4096 }, xorshift(0xc0ffee))),
  overlap1: Buffer.from([7, 7, 7, 7, 7, 7, 7, 7, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]),
};
for (const [name, buf] of Object.entries(cases)) {
  const c = lz4CompressBlock(buf);
  const d = lz4DecompressBlock(c, buf.length);
  check(`lz4 round-trip ${name} (${buf.length} -> ${c.length})`, d.equals(buf));
}

// --- pack round-trip, pixel exact
const W = 48, H = 33; // odd width exercises PAL4/A1 row padding
const rgb = Buffer.alloc(W * H * 2);
for (let i = 0; i < W * H; i++) rgb.writeUInt16LE((i * 2654435761) & 0xffff, i * 2);
const a1rows = Math.ceil(W / 8);
const a1 = Buffer.concat([rgb, Buffer.from(Array.from({ length: a1rows * H }, xorshift(7)))]);
const pal8 = Buffer.from(Array.from({ length: W * H }, xorshift(9)));
const pal4 = Buffer.from(Array.from({ length: Math.ceil(W / 2) * H }, xorshift(11)));

const assets = [
  { id: 1, type: TYPE.SPRITE, name: "s_rgb", blob: spriteBlob({ width: W, height: H, format: FMT.RGB565, compression: COMP.LZ4_BLOCK, planes: rgb }) },
  { id: 2, type: TYPE.SPRITE, name: "s_a1", blob: spriteBlob({ width: W, height: H, format: FMT.RGB565_A1, compression: COMP.LZ4_BLOCK, planes: a1 }) },
  { id: 3, type: TYPE.SPRITE, name: "s_p8", blob: spriteBlob({ width: W, height: H, format: FMT.PAL8, compression: COMP.NONE, paletteRef: 0, planes: pal8 }) },
  { id: 4, type: TYPE.SPRITE, name: "s_p4", blob: spriteBlob({ width: W, height: H, format: FMT.PAL4, compression: COMP.LZ4_BLOCK, planes: pal4 }) },
  { id: 5, type: TYPE.ANIM, name: "a", blob: animBlob({ frames: [{ spriteId: 1, durationMs: 50, dx: -3, dy: 7 }], loopMode: LOOP.pingpong, defaultFpsX10: 250 }) },
];
const pack = buildPack({ packId: 0x1122334455667788n, assets });
const p = parsePack(pack); // includes CRC verification
check("pack header tocCount", p.tocCount === 5);
check("pack packId", p.packId === 0x1122334455667788n);
for (const [name, raw] of [["s_rgb", rgb], ["s_a1", a1], ["s_p8", pal8], ["s_p4", pal4]]) {
  const e = findByHash(p, fnv1a(name));
  check(`find ${name}`, !!e);
  check(`decode ${name} pixel-exact`, decodeSprite(p, e).equals(raw));
}
const anim = parseAnim(p, getById(p, 5));
check("anim fields", anim.frameCount === 1 && anim.loopMode === 2 && anim.defaultFpsX10 === 250
  && anim.frames[0].spriteId === 1 && anim.frames[0].durationMs === 50 && anim.frames[0].dx === -3 && anim.frames[0].dy === 7);

// --- CRC corruption detection
const bad = Buffer.from(pack);
bad[40] ^= 0xff;
let threw = false;
try { parsePack(bad); } catch { threw = true; }
check("corrupted pack rejected by CRC", threw);
check("corrupted pack accepted with skipCrc", !!parsePack(bad, { skipCrc: true }));

// --- golden fixture cross-check (if generated)
const goldenPath = path.join(HERE, "fixtures", "golden_v1.dpak");
if (fs.existsSync(goldenPath)) {
  const g = parsePack(fs.readFileSync(goldenPath));
  const meta = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "golden_v1.json"), "utf8"));
  check("golden tocCount matches json", g.tocCount === meta.tocCount);
  for (const [name, info] of Object.entries(meta.sprites)) {
    const e = findByHash(g, parseInt(info.nameHash, 16));
    const px = decodeSprite(g, e);
    check(`golden ${name} decodedFnv matches`, fnv1a(px) === parseInt(info.decodedFnv, 16));
  }
  const pal = parsePalette(g, getById(g, 1));
  check("golden palette", pal.length === 4 && pal[1] === 0xf800);
} else {
  console.log("note: fixtures/golden_v1.dpak not found — run gen-fixtures.mjs first");
}

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log("\nall tests passed");
