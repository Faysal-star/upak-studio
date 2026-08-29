#!/usr/bin/env node
// dpak-cli — DPAK v1 asset pack encoder/inspector.
//
// Usage:
//   node dpak-cli.mjs pack --out demo.dpak --anim name=demo,fps=12.5,loop=loop f1.png f2.png ...
//                    [--emit-c out.h]
//   node dpak-cli.mjs inspect file.dpak
//
// PNG decoding needs `pngjs` (npm install in this directory). Only `pack` uses it.
import fs from "node:fs";
import path from "node:path";
import { fnv1a } from "./fnv.mjs";
import { buildPack, spriteBlob, animBlob, emitCHeader, rgb888to565, TYPE, FMT, COMP, LOOP } from "./dpakw.mjs";
import { parsePack, decodeSprite, parseAnim, parsePalette, spriteHeader, TYPE_NAMES, FMT_NAMES, COMP_NAMES } from "./dpakr.mjs";

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      opts[a.slice(2)] = argv[++i];
    } else {
      pos.push(a);
    }
  }
  return { opts, pos };
}

async function pngToPlanes(file) {
  let PNG;
  try {
    ({ PNG } = await import("pngjs"));
  } catch {
    fail("pngjs not installed — run `npm install` in tools/dpak-cli");
  }
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png; // RGBA8
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 128) { hasAlpha = true; break; }
  }
  const color = Buffer.alloc(width * height * 2);
  for (let p = 0; p < width * height; p++) {
    color.writeUInt16LE(rgb888to565(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]), p * 2);
  }
  if (!hasAlpha) return { width, height, format: FMT.RGB565, planes: color };
  // A1 mask: rows padded to whole bytes, MSB = leftmost pixel, bit 1 = opaque (threshold 128).
  const rowBytes = Math.ceil(width / 8);
  const mask = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] >= 128) mask[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, height, format: FMT.RGB565_A1, planes: Buffer.concat([color, mask]) };
}

async function cmdPack(argv) {
  const { opts, pos } = parseArgs(argv);
  if (!opts.out) fail("pack: --out is required");
  if (!opts.anim) fail("pack: --anim name=...,fps=...,loop=... is required");
  if (pos.length === 0) fail("pack: at least one PNG frame required");
  const anim = Object.fromEntries(opts.anim.split(",").map((kv) => kv.split("=")));
  if (!anim.name) fail("pack: --anim needs name=");
  const fps = parseFloat(anim.fps ?? "12.5");
  const loopMode = LOOP[anim.loop ?? "loop"];
  if (loopMode === undefined) fail(`pack: bad loop mode '${anim.loop}' (once|loop|pingpong)`);

  const assets = [];
  const frames = [];
  let id = 1;
  const durationMs = Math.round(1000 / fps);
  for (const f of pos) {
    const { width, height, format, planes } = await pngToPlanes(f);
    const name = `${anim.name}_f${frames.length}`;
    assets.push({ id, type: TYPE.SPRITE, name, blob: spriteBlob({ width, height, format, compression: COMP.LZ4_BLOCK, planes }) });
    frames.push({ spriteId: id, durationMs });
    console.log(`  frame ${frames.length - 1}: ${path.basename(f)} ${width}x${height} ${FMT_NAMES[format]}`);
    id++;
  }
  assets.push({
    id,
    type: TYPE.ANIM,
    name: anim.name,
    blob: animBlob({ frames, loopMode, defaultFpsX10: Math.round(fps * 10) }),
  });

  // packId: random unless --packid given (hex)
  const packId = opts.packid ? BigInt(`0x${opts.packid}`) : (BigInt(Math.floor(Math.random() * 0x100000000)) << 32n) | BigInt(Math.floor(Math.random() * 0x100000000));
  const pack = buildPack({ packId, assets });
  fs.writeFileSync(opts.out, pack);
  console.log(`wrote ${opts.out} (${pack.length} bytes, ${assets.length} assets, anim '${anim.name}' hash 0x${fnv1a(anim.name).toString(16)})`);

  if (opts["emit-c"]) {
    const constants = { DPAK_EMBED_CRC32: parsePack(pack).crc, DPAK_EMBED_PACKID: packId };
    fs.writeFileSync(opts["emit-c"], emitCHeader({ pack, arrayName: "g_dpak_embed", guard: "DPAK_EMBED_H", constants }));
    console.log(`wrote ${opts["emit-c"]}`);
  }
}

function cmdInspect(argv) {
  const { pos, opts } = parseArgs(argv);
  if (pos.length !== 1) fail("inspect: exactly one file argument");
  const buf = fs.readFileSync(pos[0]);
  const pack = parsePack(buf, { skipCrc: opts["skip-crc"] !== undefined });
  console.log(`DPAK v${pack.version}  size=${buf.length}  tocCount=${pack.tocCount}  crc32=0x${pack.crc.toString(16).padStart(8, "0")}  packId=0x${pack.packId.toString(16).padStart(16, "0")}`);
  for (const e of pack.toc) {
    let extra = "";
    if (e.type === TYPE.SPRITE) {
      const h = spriteHeader(pack, e);
      extra = `${h.width}x${h.height} ${FMT_NAMES[h.format] ?? h.format} ${COMP_NAMES[h.compression] ?? h.compression} raw=${h.rawSize}` +
        (h.paletteRef ? ` pal=${h.paletteRef}` : "") +
        ` (${(e.length / h.rawSize * 100).toFixed(0)}% of raw)`;
      try {
        const px = decodeSprite(pack, e);
        extra += ` decodedFnv=0x${fnv1a(px).toString(16)}`;
      } catch (err) {
        extra += ` DECODE-FAIL: ${err.message}`;
      }
    } else if (e.type === TYPE.ANIM) {
      const a = parseAnim(pack, e);
      extra = `${a.frameCount} frames loop=${a.loopMode} fpsX10=${a.defaultFpsX10} sprites=[${a.frames.map((f) => f.spriteId).join(",")}]`;
    } else if (e.type === TYPE.PALETTE) {
      const c = parsePalette(pack, e);
      extra = `${c.length} colors: ${c.slice(0, 8).map((v) => "0x" + v.toString(16).padStart(4, "0")).join(" ")}${c.length > 8 ? " ..." : ""}`;
    }
    console.log(`  #${e.assetId} ${TYPE_NAMES[e.type] ?? "type" + e.type}  hash=0x${e.nameHash.toString(16).padStart(8, "0")}  off=${e.offset} len=${e.length}  ${extra}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "pack") await cmdPack(rest);
else if (cmd === "inspect") cmdInspect(rest);
else {
  console.log("usage: dpak-cli.mjs pack --out FILE --anim name=N,fps=F,loop=M [--emit-c out.h] [--packid HEX] frame.png...");
  console.log("       dpak-cli.mjs inspect FILE [--skip-crc x]");
  process.exit(cmd ? 1 : 0);
}
