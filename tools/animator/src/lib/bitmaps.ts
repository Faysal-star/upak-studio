"use client";

// Browser-side asset plumbing for overlay layers:
// - decode layer src data URLs into raw RGBA bitmaps (cached per src)
// - SVG width/height injection (derived from viewBox) so drawImage works
//   cross-browser
// - composite cache: flattened frame RGBA keyed by (frame pixels, sampled
//   layer transforms, bitmap readiness) so playback stays smooth
// - import helpers (file -> layer descriptor, rasterize-to-pixels)

import { flattenFrame, type SrcBitmap } from "./composite";
import { sampleLayerTransform, type OverlayLayer } from "./layers";
import type { Frame } from "../store/project";
import { DOC_H, DOC_W } from "../store/project";

// ---------------------------------------------------------------- SVG sizing

// Ensure the root <svg> has width/height attributes; derive from viewBox when
// missing (Firefox renders drawImage of a dimensionless SVG at 0x0).
export function ensureSvgDimensions(svgText: string): {
  text: string;
  width: number;
  height: number;
} {
  let width = 0;
  let height = 0;
  let text = svgText;
  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const root = doc.documentElement;
    if (root.tagName.toLowerCase() === "svg") {
      const wAttr = root.getAttribute("width");
      const hAttr = root.getAttribute("height");
      const parseLen = (v: string | null): number => {
        if (!v) return 0;
        const n = parseFloat(v);
        return Number.isFinite(n) && n > 0 && !v.includes("%") ? n : 0;
      };
      width = parseLen(wAttr);
      height = parseLen(hAttr);
      if (!width || !height) {
        const vb = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
        if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
          width = width || vb[2];
          height = height || vb[3];
        }
      }
      if (!width || !height) {
        width = width || 240;
        height = height || 240;
      }
      root.setAttribute("width", String(width));
      root.setAttribute("height", String(height));
      if (!root.getAttribute("viewBox")) {
        root.setAttribute("viewBox", `0 0 ${width} ${height}`);
      }
      text = new XMLSerializer().serializeToString(root);
    }
  } catch {
    width = 240;
    height = 240;
  }
  return { text, width, height };
}

export function svgTextToDataUrl(text: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
}

// -------------------------------------------------------------- bitmap cache

interface CacheEntry {
  bmp: SrcBitmap | null;
  loading: boolean;
  error: boolean;
  version: number;
}

const bitmapCache = new Map<string, CacheEntry>();
let globalVersion = 0;
const listeners = new Set<() => void>();

export function subscribeBitmaps(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function bitmapsVersion(): number {
  return globalVersion;
}
function notify(): void {
  globalVersion++;
  listeners.forEach((cb) => cb());
}

function decodeSrc(src: string, entry: CacheEntry): void {
  const img = new Image();
  img.onload = () => {
    try {
      const w = Math.max(1, img.naturalWidth || img.width);
      const h = Math.max(1, img.naturalHeight || img.height);
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      entry.bmp = { data: ctx.getImageData(0, 0, w, h).data, w, h };
    } catch {
      entry.error = true;
    }
    entry.loading = false;
    notify();
  };
  img.onerror = () => {
    entry.error = true;
    entry.loading = false;
    notify();
  };
  img.src = src;
}

// Sync accessor; kicks off an async decode on first request.
export function getBitmap(layer: Pick<OverlayLayer, "src">): SrcBitmap | null {
  let entry = bitmapCache.get(layer.src);
  if (!entry) {
    entry = { bmp: null, loading: true, error: false, version: 0 };
    bitmapCache.set(layer.src, entry);
    decodeSrc(layer.src, entry);
  }
  return entry.bmp;
}

// Await decode of every layer's bitmap (used before export/stamp).
export function ensureBitmaps(layers: OverlayLayer[]): Promise<void> {
  const pending = layers.filter((l) => {
    getBitmap(l); // kick off decode
    const e = bitmapCache.get(l.src);
    return e && e.loading;
  });
  if (pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      const stillLoading = layers.some((l) => bitmapCache.get(l.src)?.loading);
      if (!stillLoading) {
        unsub();
        resolve();
      }
    };
    const unsub = subscribeBitmaps(check);
    check();
  });
}

// ------------------------------------------------------------ composite cache

interface CompositeEntry {
  sig: string;
  out: Uint8ClampedArray;
}

const compositeCache = new Map<string, CompositeEntry>();
let bufSeq = 1;
const bufIds = new WeakMap<Uint8ClampedArray, number>();
function idOfBuf(b: Uint8ClampedArray): number {
  let id = bufIds.get(b);
  if (!id) {
    id = bufSeq++;
    bufIds.set(b, id);
  }
  return id;
}

// Flatten a frame with all visible layers; identical code path to export.
// Cached by a signature of the frame pixels identity + each layer's sampled
// transform (so playback re-uses rasters until something actually changes).
export function compositeFrameCached(
  frame: Frame,
  layers: OverlayLayer[],
  frameIndex: number
): Uint8ClampedArray {
  const visible = layers.filter((l) => l.visible && l.opacity > 0);
  if (visible.length === 0) return frame.data;
  const sig =
    idOfBuf(frame.data) +
    "|" +
    layers
      .map((l) => {
        if (!l.visible || l.opacity <= 0) return `${l.id}:off`;
        const t = sampleLayerTransform(l, frameIndex);
        const ready = bitmapCache.get(l.src)?.bmp ? 1 : 0;
        return `${l.id}:${l.opacity}:${ready}:${t.x.toFixed(3)},${t.y.toFixed(3)},${t.scale.toFixed(4)},${t.rotation.toFixed(3)},${t.opacity.toFixed(3)}`;
      })
      .join(";");
  const hit = compositeCache.get(frame.id);
  if (hit && hit.sig === sig) return hit.out;
  const out = flattenFrame(frame.data, DOC_W, DOC_H, layers, frameIndex, getBitmap);
  compositeCache.set(frame.id, { sig, out });
  if (compositeCache.size > 256) {
    const first = compositeCache.keys().next().value;
    if (first !== undefined) compositeCache.delete(first);
  }
  return out;
}

// ------------------------------------------------------------- import helpers

export interface ImportedAsset {
  type: "image" | "svg";
  src: string; // data URL
  naturalW: number;
  naturalH: number;
  name: string;
}

const MAX_IMPORT_DIM = 1024; // large photos are downscaled to keep localStorage sane

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

export async function fileToAsset(file: File): Promise<ImportedAsset> {
  const name = (file.name || "imported").replace(/\.[^.]+$/, "") || "imported";
  const isSvg =
    file.type === "image/svg+xml" || /\.svg$/i.test(file.name || "");
  if (isSvg) {
    const text = await file.text();
    const { text: fixed, width, height } = ensureSvgDimensions(text);
    return { type: "svg", src: svgTextToDataUrl(fixed), naturalW: width, naturalH: height, name };
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
  }
  let src = await readAsDataUrl(file);
  const img = await loadImage(src);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w < 1 || h < 1) throw new Error("image has no pixels");
  if (Math.max(w, h) > MAX_IMPORT_DIM) {
    const k = MAX_IMPORT_DIM / Math.max(w, h);
    const nw = Math.max(1, Math.round(w * k));
    const nh = Math.max(1, Math.round(h * k));
    const cv = document.createElement("canvas");
    cv.width = nw;
    cv.height = nh;
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, nw, nh);
    src = cv.toDataURL("image/png");
    w = nw;
    h = nh;
  }
  return { type: "image", src, naturalW: w, naturalH: h, name };
}

// Default placement: centered; contain-fit into 240x240 but never upscaled
// (upscaling pixel-art imports just blurs them — scale up manually if wanted).
export function containScale(naturalW: number, naturalH: number): number {
  return Math.min(1, Math.min(DOC_W / naturalW, DOC_H / naturalH));
}

export type FitMode = "contain" | "cover" | "stretch" | "1:1";

// Rasterize an asset straight into a 240x240 RGBA buffer over existing pixels.
export async function rasterizeToPixels(
  asset: ImportedAsset,
  base: Uint8ClampedArray,
  fit: FitMode,
  smoothing: boolean
): Promise<Uint8ClampedArray> {
  const img = await loadImage(asset.src);
  const cv = document.createElement("canvas");
  cv.width = DOC_W;
  cv.height = DOC_H;
  const ctx = cv.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(base), DOC_W, DOC_H), 0, 0);
  ctx.imageSmoothingEnabled = smoothing;
  if (smoothing) ctx.imageSmoothingQuality = "high";
  const w = asset.naturalW;
  const h = asset.naturalH;
  let dw = DOC_W;
  let dh = DOC_H;
  if (fit === "contain") {
    const k = Math.min(DOC_W / w, DOC_H / h);
    dw = w * k;
    dh = h * k;
  } else if (fit === "cover") {
    const k = Math.max(DOC_W / w, DOC_H / h);
    dw = w * k;
    dh = h * k;
  } else if (fit === "1:1") {
    dw = w;
    dh = h;
  }
  ctx.drawImage(img, (DOC_W - dw) / 2, (DOC_H - dh) / 2, dw, dh);
  return ctx.getImageData(0, 0, DOC_W, DOC_H).data;
}
