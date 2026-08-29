// Software compositor: draws overlay layers (with keyframed transforms) over a
// frame's raster into a plain RGBA buffer. Pure TS, no canvas — the SAME code
// path renders the editor canvas, the device preview, playback, and the export
// flatten, so what you see is byte-for-byte what ships.

import { sampleLayerTransform, type OverlayLayer, type SampledTransform } from "./layers";

export interface SrcBitmap {
  data: Uint8ClampedArray; // RGBA, w*h*4
  w: number;
  h: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Draw `src` transformed (translate to center x/y, uniform scale, rotation in
// degrees, opacity) onto dst with source-over blending. Bilinear sampling with
// alpha-weighted (premultiplied) filtering.
export function drawLayerInto(
  dst: Uint8ClampedArray,
  dw: number,
  dh: number,
  src: SrcBitmap,
  tr: SampledTransform,
  layerOpacity: number
): void {
  const op = clamp01(tr.opacity) * clamp01(layerOpacity);
  if (op <= 0 || tr.scale <= 0 || src.w <= 0 || src.h <= 0) return;

  const rad = (tr.rotation * Math.PI) / 180;
  const cosF = Math.cos(rad);
  const sinF = Math.sin(rad);
  const s = tr.scale;
  const hw = src.w / 2;
  const hh = src.h / 2;

  // Forward-transform the source corners to bound the dst region we touch.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [cx, cy] of [
    [-hw, -hh],
    [hw, -hh],
    [-hw, hh],
    [hw, hh],
  ]) {
    const fx = tr.x + (cx * cosF - cy * sinF) * s;
    const fy = tr.y + (cx * sinF + cy * cosF) * s;
    if (fx < minX) minX = fx;
    if (fx > maxX) maxX = fx;
    if (fy < minY) minY = fy;
    if (fy > maxY) maxY = fy;
  }
  const x0 = Math.max(0, Math.floor(minX) - 1);
  const y0 = Math.max(0, Math.floor(minY) - 1);
  const x1 = Math.min(dw - 1, Math.ceil(maxX) + 1);
  const y1 = Math.min(dh - 1, Math.ceil(maxY) + 1);
  if (x1 < x0 || y1 < y0) return;

  // Inverse mapping: dst pixel center -> src coords.
  const inv = 1 / s;
  const cosI = Math.cos(-rad);
  const sinI = Math.sin(-rad);
  const sdata = src.data;
  const sw = src.w;
  const sh = src.h;

  for (let dy = y0; dy <= y1; dy++) {
    const oy = dy + 0.5 - tr.y;
    for (let dx = x0; dx <= x1; dx++) {
      const ox = dx + 0.5 - tr.x;
      const sx = (ox * cosI - oy * sinI) * inv + hw - 0.5;
      const sy = (ox * sinI + oy * cosI) * inv + hh - 0.5;
      if (sx < -1 || sx >= sw || sy < -1 || sy >= sh) continue;

      // Bilinear tap with premultiplied accumulation.
      const fx0 = Math.floor(sx);
      const fy0 = Math.floor(sy);
      const tx = sx - fx0;
      const ty = sy - fy0;
      let pr = 0, pg = 0, pb = 0, pa = 0;
      for (let j = 0; j <= 1; j++) {
        const yy = fy0 + j;
        if (yy < 0 || yy >= sh) continue;
        const wy = j === 0 ? 1 - ty : ty;
        for (let i = 0; i <= 1; i++) {
          const xx = fx0 + i;
          if (xx < 0 || xx >= sw) continue;
          const w = wy * (i === 0 ? 1 - tx : tx);
          if (w <= 0) continue;
          const o = (yy * sw + xx) * 4;
          const a = sdata[o + 3] / 255;
          pr += sdata[o] * a * w;
          pg += sdata[o + 1] * a * w;
          pb += sdata[o + 2] * a * w;
          pa += a * w;
        }
      }
      if (pa <= 0) continue;
      const sa = clamp01(pa) * op;
      if (sa <= 0) continue;
      const sr = pr / pa;
      const sg = pg / pa;
      const sb = pb / pa;

      // source-over onto straight-alpha dst
      const o = (dy * dw + dx) * 4;
      const da = dst[o + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA <= 0) {
        dst[o] = 0; dst[o + 1] = 0; dst[o + 2] = 0; dst[o + 3] = 0;
        continue;
      }
      dst[o] = Math.round((sr * sa + dst[o] * da * (1 - sa)) / outA);
      dst[o + 1] = Math.round((sg * sa + dst[o + 1] * da * (1 - sa)) / outA);
      dst[o + 2] = Math.round((sb * sa + dst[o + 2] * da * (1 - sa)) / outA);
      dst[o + 3] = Math.round(outA * 255);
    }
  }
}

export type BitmapProvider = (layer: OverlayLayer) => SrcBitmap | null;

// Flatten one timeline frame: raster + every visible overlay layer sampled at
// `frameIndex`. Layers render in array order (index 0 = bottom). Layers whose
// bitmap is not available yet are skipped (callers awaiting export must ensure
// bitmaps are loaded first).
export function flattenFrame(
  frameData: Uint8ClampedArray,
  w: number,
  h: number,
  layers: OverlayLayer[],
  frameIndex: number,
  getBitmap: BitmapProvider
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(frameData);
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const bmp = getBitmap(layer);
    if (!bmp) continue;
    const tr = sampleLayerTransform(layer, frameIndex);
    drawLayerInto(out, w, h, bmp, tr, layer.opacity);
  }
  return out;
}
