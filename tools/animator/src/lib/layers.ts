// Overlay layer model v2: document-level image/SVG layers animated with
// keyframed transforms over the per-frame raster. Pure TS, no React, no canvas.

export type Easing = "linear" | "easeInQuad" | "easeOutQuad" | "easeInOutQuad";

export interface Keyframe {
  frame: number; // frame index in the timeline
  x: number; // layer center in doc coords
  y: number;
  scale: number; // uniform
  rotation: number; // degrees, clockwise
  opacity: number; // 0..1
  easing: Easing; // easing applied on the segment LEAVING this keyframe
}

export interface OverlayLayer {
  id: string;
  name: string;
  type: "image" | "svg";
  src: string; // data URL (SVG keeps original text as data URL)
  naturalW: number;
  naturalH: number;
  visible: boolean;
  opacity: number; // 0..1, multiplied with keyframed opacity
  keyframes: Keyframe[]; // sorted by frame, unique frames
}

export interface SampledTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export const DEFAULT_TRANSFORM: SampledTransform = {
  x: 120,
  y: 120,
  scale: 1,
  rotation: 0,
  opacity: 1,
};

let layerSeq = 0;
export function newLayerId(): string {
  return `l${Date.now().toString(36)}_${layerSeq++}`;
}

export function applyEasing(easing: Easing, t: number): number {
  switch (easing) {
    case "easeInQuad":
      return t * t;
    case "easeOutQuad":
      return t * (2 - t);
    case "easeInOutQuad":
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    default:
      return t;
  }
}

function pick(k: Keyframe): SampledTransform {
  return { x: k.x, y: k.y, scale: k.scale, rotation: k.rotation, opacity: k.opacity };
}

// Sample a layer's transform at a frame. Between keyframes the LEFT keyframe's
// easing applies; before the first / after the last keyframe the boundary
// keyframe holds; a single keyframe is constant; no keyframes -> default.
export function sampleLayerTransform(
  layer: Pick<OverlayLayer, "keyframes">,
  frame: number
): SampledTransform {
  const kfs = layer.keyframes;
  if (kfs.length === 0) return { ...DEFAULT_TRANSFORM };
  if (frame <= kfs[0].frame) return pick(kfs[0]);
  const last = kfs[kfs.length - 1];
  if (frame >= last.frame) return pick(last);
  let i = 0;
  while (i + 1 < kfs.length && kfs[i + 1].frame <= frame) i++;
  const a = kfs[i];
  const b = kfs[i + 1];
  if (b.frame === a.frame) return pick(b);
  const t = applyEasing(a.easing, (frame - a.frame) / (b.frame - a.frame));
  const lerp = (u: number, v: number) => u + (v - u) * t;
  return {
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    scale: lerp(a.scale, b.scale),
    rotation: lerp(a.rotation, b.rotation),
    opacity: lerp(a.opacity, b.opacity),
  };
}

// Insert or replace the keyframe at kf.frame; returns a new sorted array.
export function upsertKeyframe(kfs: Keyframe[], kf: Keyframe): Keyframe[] {
  const out = kfs.filter((k) => k.frame !== kf.frame);
  out.push({ ...kf });
  out.sort((a, b) => a.frame - b.frame);
  return out;
}

export function deleteKeyframe(kfs: Keyframe[], frame: number): Keyframe[] {
  return kfs.filter((k) => k.frame !== frame);
}

export function keyframeAt(kfs: Keyframe[], frame: number): Keyframe | undefined {
  return kfs.find((k) => k.frame === frame);
}

// Shift keyframe frame indices when frames are inserted/removed in the timeline.
// Insertion at index i: shift kfs with frame >= i by +1.
// Deletion of index i: drop kfs at i, shift kfs with frame > i by -1.
export function shiftKeyframesForInsert(kfs: Keyframe[], insertIndex: number): Keyframe[] {
  return kfs.map((k) => (k.frame >= insertIndex ? { ...k, frame: k.frame + 1 } : k));
}

export function shiftKeyframesForDelete(kfs: Keyframe[], deleteIndex: number): Keyframe[] {
  return kfs
    .filter((k) => k.frame !== deleteIndex)
    .map((k) => (k.frame > deleteIndex ? { ...k, frame: k.frame - 1 } : k));
}
