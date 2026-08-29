"use client";

// Text rasterization for the Text tool (T). Two paths:
//  - "pixel": the built-in 5×7 bitmap font, always crisp, integer scales.
//  - system font stacks rendered on an offscreen canvas, with an optional
//    "crisp" threshold that binarizes alpha at 50% so small text on the
//    240×240 doc stays sharp.

import { hexToRgba } from "./draw";
import type { Clip } from "./selection";
import { drawPixelText, measurePixelText } from "./pixelfont";

export interface TextStyle {
  text: string;
  font: string; // "pixel" or a CSS font stack
  size: number; // px; for "pixel" this maps to scale 1/2/3 (7/14/21px tall)
  bold: boolean;
  color: string; // #rrggbb
  crisp: boolean; // threshold alpha at 50% (system fonts; pixel font always crisp)
}

export const TEXT_FONTS: { id: string; label: string; stack: string }[] = [
  { id: "pixel", label: "Pixel 5×7 (built-in)", stack: "" },
  { id: "sans", label: "Sans-serif", stack: "Arial, Helvetica, sans-serif" },
  { id: "serif", label: "Serif", stack: "Georgia, 'Times New Roman', serif" },
  { id: "mono", label: "Monospace", stack: "'Courier New', Consolas, monospace" },
  { id: "rounded", label: "Rounded", stack: "'Comic Sans MS', 'Segoe UI', sans-serif" },
];

export function fontStack(id: string): string {
  return TEXT_FONTS.find((f) => f.id === id)?.stack ?? TEXT_FONTS[1].stack;
}

/** Pixel-font scale (×1/×2/×3) for a requested px size (7/14/21 glyph height). */
export function pixelScaleForSize(size: number): number {
  return Math.max(1, Math.min(3, Math.round(size / 7)));
}

/** Rasterize styled text to an RGBA clip. Returns null for empty/blank text. */
export function rasterizeText(style: TextStyle): Clip | null {
  const text = style.text.replace(/[\r\n]+/g, " ");
  if (!text.trim()) return null;
  const rgba = hexToRgba(style.color);

  if (style.font === "pixel") {
    const scale = pixelScaleForSize(style.size);
    const { w, h } = measurePixelText(text, scale);
    if (w === 0) return null;
    const data = new Uint8ClampedArray(w * h * 4);
    drawPixelText(data, w, h, 0, 0, text, scale, rgba);
    return { data, w, h };
  }

  const size = Math.max(4, Math.min(160, Math.round(style.size)));
  const font = `${style.bold ? "bold " : ""}${size}px ${fontStack(style.font)}`;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = font;
  const m = probe.measureText(text);
  const ascent = Math.ceil(m.actualBoundingBoxAscent || size * 0.8);
  const descent = Math.ceil(m.actualBoundingBoxDescent || size * 0.25);
  const w = Math.max(1, Math.ceil(m.width) + 2);
  const h = Math.max(1, ascent + descent + 2);

  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = style.color;
  ctx.fillText(text, 1, ascent + 1);

  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    if (style.crisp) {
      if (a >= 128) {
        data[i] = rgba[0];
        data[i + 1] = rgba[1];
        data[i + 2] = rgba[2];
        data[i + 3] = 255;
      } else {
        data[i + 3] = 0;
      }
    } else {
      // keep anti-aliased alpha but force the exact fill color
      data[i] = rgba[0];
      data[i + 1] = rgba[1];
      data[i + 2] = rgba[2];
    }
  }
  return { data: new Uint8ClampedArray(data), w, h };
}

/** Render a clip to a transparent PNG data URL (for text-as-layer). */
export function clipToDataUrl(clip: Clip): string {
  const cv = document.createElement("canvas");
  cv.width = clip.w;
  cv.height = clip.h;
  cv.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(clip.data), clip.w, clip.h), 0, 0);
  return cv.toDataURL("image/png");
}
