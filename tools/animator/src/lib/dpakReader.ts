// Minimal DPAK v1 reader — used by the golden/round-trip tests.

import { crc32 } from "./crc32";
import { decompressBlock } from "./lz4";
import {
  COMP_LZ4,
  COMP_NONE,
  FMT_RGB565,
  FMT_RGB565_A1,
  TYPE_ANIM,
} from "./dpak";

export interface TocEntry {
  assetId: number;
  type: number;
  nameHash: number;
  offset: number;
  length: number;
}

export interface DpakFile {
  version: number;
  tocCount: number;
  packId: bigint;
  crcStored: number;
  crcOk: boolean;
  toc: TocEntry[];
  data: Uint8Array;
}

export function readDpak(data: Uint8Array): DpakFile {
  if (data.length < 32) throw new Error("dpak: too short");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (!(data[0] === 0x44 && data[1] === 0x50 && data[2] === 0x41 && data[3] === 0x4b))
    throw new Error("dpak: bad magic");
  const version = dv.getUint16(4, true);
  if (version !== 1) throw new Error("dpak: bad version");
  const tocCount = dv.getUint16(8, true);
  const tocOffset = dv.getUint32(12, true);
  const crcStored = dv.getUint32(16, true);
  const packId = dv.getBigUint64(20, true);
  const crcOk = crc32(data.subarray(32)) === crcStored;
  if (tocOffset + tocCount * 32 > data.length) throw new Error("dpak: TOC out of bounds");
  const toc: TocEntry[] = [];
  for (let i = 0; i < tocCount; i++) {
    const t = tocOffset + i * 32;
    const e: TocEntry = {
      assetId: dv.getUint32(t, true),
      type: data[t + 4],
      nameHash: dv.getUint32(t + 8, true),
      offset: dv.getUint32(t + 12, true),
      length: dv.getUint32(t + 16, true),
    };
    if (e.offset + e.length > data.length) throw new Error("dpak: blob out of bounds");
    toc.push(e);
  }
  return { version, tocCount, packId, crcStored, crcOk, toc, data };
}

export interface SpriteHeader {
  width: number;
  height: number;
  format: number;
  compression: number;
  paletteRef: number;
  anchorX: number;
  anchorY: number;
  rawSize: number;
}

// Decompressed payload (concatenated pixel planes) + header — works for every
// sprite format, including PAL8/PAL4 which decodeSprite() doesn't expand yet.
export function decodeSpritePayload(
  pak: DpakFile,
  entry: TocEntry
): { header: SpriteHeader; raw: Uint8Array } {
  const blob = pak.data.subarray(entry.offset, entry.offset + entry.length);
  if (blob.length < 16) throw new Error("dpak: sprite blob too short");
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const header: SpriteHeader = {
    width: dv.getUint16(0, true),
    height: dv.getUint16(2, true),
    format: blob[4],
    compression: blob[5],
    paletteRef: dv.getUint16(6, true),
    anchorX: dv.getInt16(8, true),
    anchorY: dv.getInt16(10, true),
    rawSize: dv.getUint32(12, true),
  };
  const payload = blob.subarray(16);
  let raw: Uint8Array;
  if (header.compression === COMP_NONE) {
    if (payload.length !== header.rawSize) throw new Error("dpak: rawSize mismatch");
    raw = payload;
  } else if (header.compression === COMP_LZ4) {
    raw = decompressBlock(payload, header.rawSize);
  } else {
    throw new Error(`dpak: unsupported compression ${header.compression}`);
  }
  return { header, raw };
}

export interface DecodedSprite {
  width: number;
  height: number;
  format: number;
  compression: number;
  rawSize: number;
  color: Uint16Array; // RGB565 per pixel
  alpha: Uint8Array | null; // 0/1 per pixel (A1 formats)
}

export function decodeSprite(pak: DpakFile, entry: TocEntry): DecodedSprite {
  const { header, raw } = decodeSpritePayload(pak, entry);
  const { width, height, format, compression, rawSize } = header;
  const n = width * height;
  const color = new Uint16Array(n);
  for (let i = 0; i < n; i++) color[i] = raw[i * 2] | (raw[i * 2 + 1] << 8);
  let alpha: Uint8Array | null = null;
  if (format === FMT_RGB565_A1) {
    alpha = new Uint8Array(n);
    const maskRowBytes = Math.ceil(width / 8);
    const maskOff = n * 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const b = raw[maskOff + y * maskRowBytes + (x >> 3)];
        alpha[y * width + x] = (b >> (7 - (x & 7))) & 1;
      }
    }
  } else if (format !== FMT_RGB565) {
    throw new Error(`dpak: reader does not support format ${format}`);
  }
  return { width, height, format, compression, rawSize, color, alpha };
}

export interface DecodedAnim {
  frameCount: number;
  loopMode: number;
  defaultFpsX10: number;
  frames: { spriteId: number; durationMs: number; dx: number; dy: number }[];
}

export function decodeAnim(pak: DpakFile, entry: TocEntry): DecodedAnim {
  if (entry.type !== TYPE_ANIM) throw new Error("dpak: not an ANIM entry");
  const blob = pak.data.subarray(entry.offset, entry.offset + entry.length);
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const frameCount = dv.getUint16(0, true);
  if (8 + frameCount * 12 > blob.length) throw new Error("dpak: anim out of bounds");
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const off = 8 + i * 12;
    frames.push({
      spriteId: dv.getUint32(off, true),
      durationMs: dv.getUint16(off + 4, true),
      dx: dv.getInt16(off + 6, true),
      dy: dv.getInt16(off + 8, true),
    });
  }
  return { frameCount, loopMode: blob[2], defaultFpsX10: dv.getUint16(4, true), frames };
}
