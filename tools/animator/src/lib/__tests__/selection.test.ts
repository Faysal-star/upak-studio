import { describe, expect, it } from "vitest";
import { blendClip, blitClip, clampRect, clearRect, extractRect } from "../selection";

const W = 8;
const H = 8;

function makeBuf(): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      buf[o] = x * 10;
      buf[o + 1] = y * 10;
      buf[o + 2] = 7;
      buf[o + 3] = (x + y) % 2 === 0 ? 255 : 0; // checker alpha
    }
  }
  return buf;
}

describe("selection", () => {
  it("clamps rects to bounds and rejects empty", () => {
    expect(clampRect({ x: -2, y: -2, w: 4, h: 4 }, W, H)).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(clampRect({ x: 10, y: 0, w: 4, h: 4 }, W, H)).toBeNull();
    expect(clampRect({ x: 3, y: 3, w: 0, h: 2 }, W, H)).toBeNull();
  });

  it("copy -> clear -> paste round-trips opaque pixels", () => {
    const buf = makeBuf();
    const original = new Uint8ClampedArray(buf);
    const r = { x: 2, y: 1, w: 3, h: 4 };
    const clip = extractRect(buf, W, H, r);
    expect(clip.w).toBe(3);
    expect(clip.h).toBe(4);
    clearRect(buf, W, H, r);
    // cleared region is fully transparent black
    for (let y = 1; y < 5; y++)
      for (let x = 2; x < 5; x++) {
        const o = (y * W + x) * 4;
        expect(Array.from(buf.subarray(o, o + 4))).toEqual([0, 0, 0, 0]);
      }
    blitClip(buf, W, H, clip, r.x, r.y);
    // opaque pixels restored exactly; transparent clip pixels leave dest alone
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (original[o + 3] > 0) {
          expect(Array.from(buf.subarray(o, o + 4))).toEqual(
            Array.from(original.subarray(o, o + 4))
          );
        }
      }
  });

  it("paste clips at buffer edges without wrapping", () => {
    const buf = new Uint8ClampedArray(W * H * 4);
    const clip = extractRect(makeBuf(), W, H, { x: 0, y: 0, w: 4, h: 4 });
    blitClip(buf, W, H, clip, 6, 6); // hangs off bottom-right
    // nothing wrapped to row starts
    for (let y = 0; y < H; y++) {
      const o = (y * W + 0) * 4;
      expect(buf[o + 3]).toBe(0);
    }
    // in-bounds corner landed
    const o = (6 * W + 6) * 4;
    expect(buf[o + 3]).toBe(255);
  });
});

describe("selection v0.3 additions", () => {
  it("extractRect records the source position for paste-in-place", () => {
    const buf = makeBuf();
    const clip = extractRect(buf, W, H, { x: 2, y: 3, w: 3, h: 2 });
    expect(clip.srcX).toBe(2);
    expect(clip.srcY).toBe(3);
    // clamped rects record the clamped origin
    const edge = extractRect(buf, W, H, { x: -2, y: -1, w: 4, h: 4 });
    expect(edge.srcX).toBe(0);
    expect(edge.srcY).toBe(0);
  });

  it("blendClip source-over blends partial alpha and skips transparent", () => {
    const buf = new Uint8ClampedArray(4 * 4); // 2x2, transparent
    buf.set([0, 0, 255, 255], 0); // (0,0) opaque blue
    const clip = {
      w: 2,
      h: 1,
      data: new Uint8ClampedArray([255, 0, 0, 128, 0, 0, 0, 0]),
    };
    blendClip(buf, 2, 2, clip, 0, 0);
    // (0,0): half red over blue
    expect(buf[3]).toBe(255);
    expect(buf[0]).toBeGreaterThan(100); // red mixed in
    expect(buf[2]).toBeGreaterThan(100); // blue remains
    // (1,0): transparent clip pixel leaves destination untouched
    expect(buf[7]).toBe(0);
  });

  it("blendClip on empty destination equals the clip color", () => {
    const buf = new Uint8ClampedArray(4);
    const clip = { w: 1, h: 1, data: new Uint8ClampedArray([10, 200, 30, 255]) };
    blendClip(buf, 1, 1, clip, 0, 0);
    expect([...buf]).toEqual([10, 200, 30, 255]);
  });
});
