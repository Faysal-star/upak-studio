import { describe, expect, it } from "vitest";
import { drawLayerInto, flattenFrame, type SrcBitmap } from "../composite";
import type { OverlayLayer } from "../layers";
import { encodeDpak } from "../dpak";
import { decodeSprite, readDpak } from "../dpakReader";
import { quantize } from "../rgb565";

const W = 240;
const H = 240;

// Deterministic synthetic "imported image": a 64x32 bitmap with an opaque
// two-tone pattern and a transparent border (stands in for a decoded PNG —
// vitest runs in node where real canvas decoding is unavailable).
function makeBitmap(): SrcBitmap {
  const w = 64;
  const h = 32;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const border = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      if (border) continue; // transparent
      const left = x < w / 2;
      data[o] = left ? 230 : 20;
      data[o + 1] = left ? 60 : 180;
      data[o + 2] = left ? 70 : 216;
      data[o + 3] = 255;
    }
  }
  return { data, w, h };
}

function makeRaster(): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    buf[o] = 10;
    buf[o + 1] = 12;
    buf[o + 2] = 20;
    buf[o + 3] = 255;
  }
  return buf;
}

function makeLayer(): OverlayLayer {
  return {
    id: "l1",
    name: "sprite",
    type: "image",
    src: "fixture://synthetic",
    naturalW: 64,
    naturalH: 32,
    visible: true,
    opacity: 1,
    keyframes: [
      { frame: 0, x: 60, y: 60, scale: 1, rotation: 0, opacity: 1, easing: "linear" },
      { frame: 4, x: 180, y: 160, scale: 2, rotation: 90, opacity: 0.75, easing: "easeInOutQuad" },
    ],
  };
}

describe("drawLayerInto", () => {
  it("stamps an unrotated unscaled bitmap pixel-exactly at integer positions", () => {
    const dst = new Uint8ClampedArray(W * H * 4); // fully transparent
    const bmp = makeBitmap();
    drawLayerInto(dst, W, H, bmp, { x: 120, y: 120, scale: 1, rotation: 0, opacity: 1 }, 1);
    // bitmap occupies x in [88,152), y in [104,136)
    const at = (x: number, y: number) => {
      const o = (y * W + x) * 4;
      return [dst[o], dst[o + 1], dst[o + 2], dst[o + 3]];
    };
    expect(at(100, 120)).toEqual([230, 60, 70, 255]); // left half
    expect(at(140, 120)).toEqual([20, 180, 216, 255]); // right half
    expect(at(89, 105)).toEqual([0, 0, 0, 0]); // transparent border kept
    expect(at(50, 50)).toEqual([0, 0, 0, 0]); // outside untouched
  });

  it("respects opacity", () => {
    const dst = makeRaster();
    const bmp = makeBitmap();
    drawLayerInto(dst, W, H, bmp, { x: 120, y: 120, scale: 1, rotation: 0, opacity: 0.5 }, 1);
    const o = (120 * W + 100) * 4;
    // 50% of [230,60,70] over [10,12,20]
    expect(dst[o]).toBe(120);
    expect(dst[o + 3]).toBe(255);
  });

  it("skips invisible work (opacity 0 / degenerate scale)", () => {
    const dst = makeRaster();
    const before = new Uint8ClampedArray(dst);
    drawLayerInto(dst, W, H, makeBitmap(), { x: 120, y: 120, scale: 0, rotation: 0, opacity: 1 }, 1);
    drawLayerInto(dst, W, H, makeBitmap(), { x: 120, y: 120, scale: 1, rotation: 0, opacity: 0 }, 1);
    expect(dst).toEqual(before);
  });
});

describe("flatten determinism + dpak round-trip", () => {
  const bmp = makeBitmap();
  const getBitmap = () => bmp;
  const layer = makeLayer();

  it("flattens a keyframed layer deterministically", () => {
    const a = flattenFrame(makeRaster(), W, H, [layer], 2, getBitmap);
    const b = flattenFrame(makeRaster(), W, H, [layer], 2, getBitmap);
    expect(a).toEqual(b);
    // and the tweened frame differs from both endpoints
    const f0 = flattenFrame(makeRaster(), W, H, [layer], 0, getBitmap);
    const f4 = flattenFrame(makeRaster(), W, H, [layer], 4, getBitmap);
    expect(a).not.toEqual(f0);
    expect(a).not.toEqual(f4);
  });

  it("skips hidden layers and layers with no bitmap", () => {
    const raster = makeRaster();
    const hidden = { ...layer, visible: false };
    expect(flattenFrame(raster, W, H, [hidden], 2, getBitmap)).toEqual(raster);
    expect(flattenFrame(raster, W, H, [layer], 2, () => null)).toEqual(raster);
  });

  it("round-trips flattened frames through the DPAK encoder pixel-exactly", () => {
    const frames = [0, 1, 2, 3, 4].map((i) => flattenFrame(makeRaster(), W, H, [layer], i, getBitmap));
    const pack = encodeDpak({
      name: "layered",
      width: W,
      height: H,
      frames: frames.map((rgba) => ({ rgba, durationMs: 100 })),
      packId: 0x1122334455667788n,
    });
    const pak = readDpak(pack);
    expect(pak.crcOk).toBe(true);
    expect(pak.tocCount).toBe(6); // 5 sprites + anim
    frames.forEach((rgba, i) => {
      const sprite = decodeSprite(pak, pak.toc[i]);
      const q = quantize(rgba, W, H, false);
      expect(Array.from(sprite.color)).toEqual(Array.from(q.color));
    });
  });
});
