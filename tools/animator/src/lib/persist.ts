// localStorage autosave of the project JSON.
// Schema v2 adds overlay layers; v1 documents (no layers) migrate cleanly.
// serialize/parse are pure and unit-tested; load/save wrap localStorage.

import type { Easing, Keyframe, OverlayLayer } from "./layers";
import type { Frame } from "../store/project";

const KEY = "deskpet-animator-project-v1"; // stable key across schema versions

function toB64(data: Uint8ClampedArray): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < data.length; i += CHUNK) {
    s += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function fromB64(b64: string): Uint8ClampedArray {
  const s = atob(b64);
  const out = new Uint8ClampedArray(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export interface SavedProject {
  frames: Frame[];
  layers: OverlayLayer[];
  current: number;
  animName: string;
}

const EASINGS: Easing[] = ["linear", "easeInQuad", "easeOutQuad", "easeInOutQuad"];

export function serializeProject(p: SavedProject): string {
  return JSON.stringify({
    v: 2,
    current: p.current,
    animName: p.animName,
    frames: p.frames.map((f) => ({ id: f.id, durationMs: f.durationMs, data: toB64(f.data) })),
    layers: p.layers.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      src: l.src,
      naturalW: l.naturalW,
      naturalH: l.naturalH,
      visible: l.visible,
      opacity: l.opacity,
      keyframes: l.keyframes,
    })),
  });
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseLayer(raw: any): OverlayLayer | null {
  if (!raw || typeof raw.src !== "string") return null;
  const kfsRaw: any[] = Array.isArray(raw.keyframes) ? raw.keyframes : [];
  const keyframes: Keyframe[] = kfsRaw
    .filter((k) => k && Number.isFinite(Number(k.frame)))
    .map((k) => ({
      frame: Math.max(0, Math.round(num(k.frame, 0))),
      x: num(k.x, 120),
      y: num(k.y, 120),
      scale: num(k.scale, 1),
      rotation: num(k.rotation, 0),
      opacity: Math.max(0, Math.min(1, num(k.opacity, 1))),
      easing: EASINGS.includes(k.easing) ? (k.easing as Easing) : "linear",
    }))
    .sort((a, b) => a.frame - b.frame);
  return {
    id: typeof raw.id === "string" ? raw.id : `l_restored_${Math.random().toString(36).slice(2)}`,
    name: typeof raw.name === "string" ? raw.name : "layer",
    type: raw.type === "svg" ? "svg" : "image",
    src: raw.src,
    naturalW: Math.max(1, Math.round(num(raw.naturalW, 1))),
    naturalH: Math.max(1, Math.round(num(raw.naturalH, 1))),
    visible: raw.visible !== false,
    opacity: Math.max(0, Math.min(1, num(raw.opacity, 1))),
    keyframes,
  };
}

// Parses a v1 OR v2 document. v1 (no layers) migrates to layers: [].
// Returns null on anything unusable — never throws.
export function parseProject(json: string): SavedProject | null {
  try {
    const doc: any = JSON.parse(json);
    if (!doc || (doc.v !== 1 && doc.v !== 2)) return null;
    if (!Array.isArray(doc.frames) || doc.frames.length === 0) return null;
    const frames: Frame[] = doc.frames.map((f: any) => ({
      id: String(f.id),
      durationMs: num(f.durationMs, 100) || 100,
      data: fromB64(f.data),
    }));
    const layers: OverlayLayer[] =
      doc.v === 2 && Array.isArray(doc.layers)
        ? (doc.layers.map(parseLayer).filter(Boolean) as OverlayLayer[])
        : [];
    return {
      frames,
      layers,
      current: Math.max(0, Math.min(num(doc.current, 0), frames.length - 1)),
      animName: typeof doc.animName === "string" ? doc.animName : "demo",
    };
  } catch {
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function saveProject(
  frames: Frame[],
  layers: OverlayLayer[],
  current: number,
  animName: string
): void {
  try {
    localStorage.setItem(KEY, serializeProject({ frames, layers, current, animName }));
  } catch {
    // quota exceeded or private mode — autosave silently skipped
  }
}

export function loadProject(): SavedProject | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return parseProject(raw);
  } catch {
    return null;
  }
}
