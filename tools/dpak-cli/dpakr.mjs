// DPAK v1 reader/decoder (JS mirror of firmware/lib/dpak/dpak.c) — used by inspect + tests.
import { crc32 } from "./crc32.mjs";
import { lz4DecompressBlock } from "./lz4.mjs";

export const TYPE_NAMES = { 1: "SPRITE", 2: "ANIM", 3: "EXPR", 4: "FONT", 5: "SOUND", 6: "PALETTE" };
export const FMT_NAMES = { 0: "RGB565", 1: "RGB565_A1", 2: "RGB565_A8", 3: "PAL8", 4: "PAL4" };
export const COMP_NAMES = { 0: "NONE", 1: "LZ4_BLOCK", 2: "RLE" };

export function parsePack(buf, { skipCrc = false } = {}) {
  if (buf.length < 32) throw new Error("dpak: too short");
  if (buf.toString("ascii", 0, 4) !== "DPAK") throw new Error("dpak: bad magic");
  const version = buf.readUInt16LE(4);
  if (version !== 1) throw new Error(`dpak: unsupported version ${version}`);
  const flags = buf.readUInt16LE(6);
  const tocCount = buf.readUInt16LE(8);
  const tocOffset = buf.readUInt32LE(12);
  const crc = buf.readUInt32LE(16);
  const packId = buf.readBigUInt64LE(20);
  if (!skipCrc) {
    const actual = crc32(buf, 32, buf.length);
    if (actual !== crc) throw new Error(`dpak: CRC mismatch (header 0x${crc.toString(16)}, actual 0x${actual.toString(16)})`);
  }
  if (tocOffset + tocCount * 32 > buf.length) throw new Error("dpak: TOC out of bounds");
  const toc = [];
  for (let i = 0; i < tocCount; i++) {
    const o = tocOffset + i * 32;
    const e = {
      assetId: buf.readUInt32LE(o),
      type: buf.readUInt8(o + 4),
      nameHash: buf.readUInt32LE(o + 8),
      offset: buf.readUInt32LE(o + 12),
      length: buf.readUInt32LE(o + 16),
    };
    if (e.offset + e.length > buf.length) throw new Error(`dpak: blob ${i} out of bounds`);
    toc.push(e);
  }
  return { buf, version, flags, tocCount, tocOffset, crc, packId, toc };
}

export function findByHash(pack, nameHash) {
  return pack.toc.find((e) => e.nameHash === nameHash) ?? null;
}

export function getById(pack, assetId) {
  return pack.toc.find((e) => e.assetId === assetId) ?? null;
}

export function spriteHeader(pack, entry) {
  if (entry.length < 16) throw new Error("dpak: sprite blob too short");
  const b = pack.buf;
  const o = entry.offset;
  return {
    width: b.readUInt16LE(o),
    height: b.readUInt16LE(o + 2),
    format: b.readUInt8(o + 4),
    compression: b.readUInt8(o + 5),
    paletteRef: b.readUInt16LE(o + 6),
    anchorX: b.readInt16LE(o + 8),
    anchorY: b.readInt16LE(o + 10),
    rawSize: b.readUInt32LE(o + 12),
  };
}

// Returns the decompressed payload (concatenated pixel planes).
export function decodeSprite(pack, entry) {
  const h = spriteHeader(pack, entry);
  const payload = pack.buf.subarray(entry.offset + 16, entry.offset + entry.length);
  if (h.compression === 0) {
    if (payload.length !== h.rawSize) throw new Error("dpak: rawSize mismatch (NONE)");
    return Buffer.from(payload);
  }
  if (h.compression === 1) return lz4DecompressBlock(payload, h.rawSize);
  throw new Error(`dpak: unsupported compression ${h.compression}`);
}

export function parseAnim(pack, entry) {
  const b = pack.buf;
  const o = entry.offset;
  if (entry.length < 8) throw new Error("dpak: anim blob too short");
  const frameCount = b.readUInt16LE(o);
  const loopMode = b.readUInt8(o + 2);
  const defaultFpsX10 = b.readUInt16LE(o + 4);
  if (entry.length < 8 + frameCount * 12) throw new Error("dpak: anim frames out of bounds");
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const fo = o + 8 + i * 12;
    frames.push({
      spriteId: b.readUInt32LE(fo),
      durationMs: b.readUInt16LE(fo + 4),
      dx: b.readInt16LE(fo + 6),
      dy: b.readInt16LE(fo + 8),
    });
  }
  return { frameCount, loopMode, defaultFpsX10, frames };
}

export function parsePalette(pack, entry) {
  const b = pack.buf;
  const count = b.readUInt16LE(entry.offset);
  if (entry.length < 4 + count * 2) throw new Error("dpak: palette out of bounds");
  const colors = [];
  for (let i = 0; i < count; i++) colors.push(b.readUInt16LE(entry.offset + 4 + i * 2));
  return colors;
}
