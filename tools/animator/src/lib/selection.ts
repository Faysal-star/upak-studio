// Rect-select clipboard ops on RGBA buffers. Pure TS, no canvas.

export interface SelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Clip {
  data: Uint8ClampedArray; // RGBA, w*h*4
  w: number;
  h: number;
  srcX?: number; // doc position the clip was copied from — paste lands here
  srcY?: number; //   by default so frame-to-frame animation lines up
}

// Clamp a rect to buffer bounds; returns null if empty after clamping.
export function clampRect(r: SelRect, w: number, h: number): SelRect | null {
  const x0 = Math.max(0, Math.min(r.x, r.x + r.w));
  const y0 = Math.max(0, Math.min(r.y, r.y + r.h));
  const x1 = Math.min(w, Math.max(r.x, r.x + r.w));
  const y1 = Math.min(h, Math.max(r.y, r.y + r.h));
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function extractRect(buf: Uint8ClampedArray, w: number, h: number, r: SelRect): Clip {
  const c = clampRect(r, w, h);
  if (!c) return { data: new Uint8ClampedArray(0), w: 0, h: 0 };
  const out = new Uint8ClampedArray(c.w * c.h * 4);
  for (let y = 0; y < c.h; y++) {
    const src = ((c.y + y) * w + c.x) * 4;
    out.set(buf.subarray(src, src + c.w * 4), y * c.w * 4);
  }
  return { data: out, w: c.w, h: c.h, srcX: c.x, srcY: c.y };
}

export function clearRect(buf: Uint8ClampedArray, w: number, h: number, r: SelRect): void {
  const c = clampRect(r, w, h);
  if (!c) return;
  for (let y = 0; y < c.h; y++) {
    const o = ((c.y + y) * w + c.x) * 4;
    buf.fill(0, o, o + c.w * 4);
  }
}

// Source-over blend clip at (dx, dy) — used for anti-aliased text stamping.
export function blendClip(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  clip: Clip,
  dx: number,
  dy: number
): void {
  for (let y = 0; y < clip.h; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= h) continue;
    for (let x = 0; x < clip.w; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= w) continue;
      const s = (y * clip.w + x) * 4;
      const sa = clip.data[s + 3] / 255;
      if (sa === 0) continue;
      const d = (ty * w + tx) * 4;
      const da = buf[d + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa === 0) continue;
      for (let ch = 0; ch < 3; ch++) {
        buf[d + ch] = Math.round(
          (clip.data[s + ch] * sa + buf[d + ch] * da * (1 - sa)) / oa
        );
      }
      buf[d + 3] = Math.round(oa * 255);
    }
  }
}

// Paste clip at (dx, dy): copies pixels with alpha > 0 (transparent clip pixels
// leave the destination untouched), clipped to bounds.
export function blitClip(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  clip: Clip,
  dx: number,
  dy: number
): void {
  for (let y = 0; y < clip.h; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= h) continue;
    for (let x = 0; x < clip.w; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= w) continue;
      const s = (y * clip.w + x) * 4;
      if (clip.data[s + 3] === 0) continue;
      const d = (ty * w + tx) * 4;
      buf[d] = clip.data[s];
      buf[d + 1] = clip.data[s + 1];
      buf[d + 2] = clip.data[s + 2];
      buf[d + 3] = clip.data[s + 3];
    }
  }
}
