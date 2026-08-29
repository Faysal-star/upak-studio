// DPAK v1 encoder per docs/architecture/asset-format-dpak.md (NORMATIVE).
// v0.1 emits RGB565 / RGB565_A1 sprites + one ANIM blob.
// TODO v0.2: PAL8/PAL4 sprite formats + PALETTE blobs.

import { crc32 } from "./crc32";
import { fnv1a32 } from "./fnv";
import { compressBlock } from "./lz4";
import { quantize } from "./rgb565";

export const DPAK_MAGIC = 0x4b415044; // "DPAK" LE
export const TYPE_SPRITE = 1;
export const TYPE_ANIM = 2;
export const FMT_RGB565 = 0;
export const FMT_RGB565_A1 = 1;
export const COMP_NONE = 0;
export const COMP_LZ4 = 1;
export const LOOP_ONCE = 0;
export const LOOP_LOOP = 1;
export const LOOP_PINGPONG = 2;

export interface DpakFrameInput {
  rgba: Uint8Array | Uint8ClampedArray; // w*h*4 row-major
  durationMs: number;
}

export interface DpakEncodeOptions {
  name: string; // anim asset name; sprite i is named `${name}_f${i}`
  width: number;
  height: number;
  frames: DpakFrameInput[];
  loopMode?: 0 | 1 | 2; // default LOOP
  dither?: boolean;
  packId?: bigint; // default: random
}

function randomU64(): bigint {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
  return v;
}

export function spriteName(animName: string, frameIndex: number): string {
  return `${animName}_f${frameIndex}`;
}

function buildSpritePayload(
  rgba: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  dither: boolean
): { raw: Uint8Array; format: number } {
  const q = quantize(rgba, w, h, dither);
  const colorBytes = w * h * 2;
  const format = q.hasTransparency ? FMT_RGB565_A1 : FMT_RGB565;
  const maskRowBytes = Math.ceil(w / 8);
  const size = colorBytes + (format === FMT_RGB565_A1 ? maskRowBytes * h : 0);
  const raw = new Uint8Array(size);
  for (let i = 0; i < w * h; i++) {
    raw[i * 2] = q.color[i] & 0xff; // little-endian pixel
    raw[i * 2 + 1] = q.color[i] >> 8;
  }
  if (format === FMT_RGB565_A1) {
    for (let y = 0; y < h; y++) {
      const rowOff = colorBytes + y * maskRowBytes;
      for (let x = 0; x < w; x++) {
        if (q.alpha[y * w + x]) raw[rowOff + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { raw, format };
}

function encodeSpriteBlob(
  rgba: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  dither: boolean
): Uint8Array {
  const { raw, format } = buildSpritePayload(rgba, w, h, dither);
  const lz4 = compressBlock(raw);
  const useLz4 = lz4.length < raw.length;
  const payload = useLz4 ? lz4 : raw;
  const blob = new Uint8Array(16 + payload.length);
  const dv = new DataView(blob.buffer);
  dv.setUint16(0, w, true);
  dv.setUint16(2, h, true);
  blob[4] = format;
  blob[5] = useLz4 ? COMP_LZ4 : COMP_NONE;
  dv.setUint16(6, 0, true); // paletteRef
  dv.setInt16(8, 0, true); // anchorX
  dv.setInt16(10, 0, true); // anchorY
  dv.setUint32(12, raw.length, true); // rawSize
  blob.set(payload, 16);
  return blob;
}

export function encodeDpak(o: DpakEncodeOptions): Uint8Array {
  if (o.frames.length === 0) throw new Error("dpak: no frames");
  if (o.frames.length > 0xffff) throw new Error("dpak: too many frames");

  const blobs: { type: number; nameHash: number; data: Uint8Array }[] = [];
  const spriteIds: number[] = [];
  o.frames.forEach((f, i) => {
    blobs.push({
      type: TYPE_SPRITE,
      nameHash: fnv1a32(spriteName(o.name, i)),
      data: encodeSpriteBlob(f.rgba, o.width, o.height, !!o.dither),
    });
    spriteIds.push(blobs.length); // assetId = 1-based TOC index
  });

  const anim = new Uint8Array(8 + 12 * o.frames.length);
  {
    const dv = new DataView(anim.buffer);
    dv.setUint16(0, o.frames.length, true);
    anim[2] = o.loopMode ?? LOOP_LOOP;
    dv.setUint16(4, 0, true); // defaultFpsX10 = 0: per-frame durations
    o.frames.forEach((f, i) => {
      const off = 8 + 12 * i;
      dv.setUint32(off, spriteIds[i], true);
      dv.setUint16(off + 4, Math.max(1, Math.min(0xffff, Math.round(f.durationMs))), true);
      dv.setInt16(off + 6, 0, true); // dx
      dv.setInt16(off + 8, 0, true); // dy
    });
  }
  blobs.push({ type: TYPE_ANIM, nameHash: fnv1a32(o.name), data: anim });

  const tocCount = blobs.length;
  const blobBase = 32 + 32 * tocCount;
  const total = blobBase + blobs.reduce((s, b) => s + b.data.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);

  // header
  out[0] = 0x44; out[1] = 0x50; out[2] = 0x41; out[3] = 0x4b;
  dv.setUint16(4, 1, true); // version
  dv.setUint16(6, 0, true); // flags
  dv.setUint16(8, tocCount, true);
  dv.setUint16(10, 0, true);
  dv.setUint32(12, 32, true); // tocOffset
  dv.setBigUint64(20, o.packId ?? randomU64(), true);
  dv.setUint32(28, 0, true);

  // TOC + blobs
  let off = blobBase;
  blobs.forEach((b, i) => {
    const t = 32 + 32 * i;
    dv.setUint32(t, i + 1, true); // assetId
    out[t + 4] = b.type;
    dv.setUint32(t + 8, b.nameHash, true);
    dv.setUint32(t + 12, off, true);
    dv.setUint32(t + 16, b.data.length, true);
    out.set(b.data, off);
    off += b.data.length;
  });

  dv.setUint32(16, crc32(out.subarray(32)), true);
  return out;
}
