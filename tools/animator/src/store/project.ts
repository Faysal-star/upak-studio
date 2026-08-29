"use client";

// Document store v2: frames of one 240x240 raster layer each, plus
// document-level overlay layers (image/SVG) with keyframed transforms.
// Undo/redo via zundo; `frames` and `layers` are history-tracked.

import { create } from "zustand";
import { temporal } from "zundo";
import {
  deleteKeyframe,
  newLayerId,
  shiftKeyframesForDelete,
  shiftKeyframesForInsert,
  upsertKeyframe,
  type Keyframe,
  type OverlayLayer,
} from "../lib/layers";

export const DOC_W = 240;
export const DOC_H = 240;

export interface Frame {
  id: string;
  durationMs: number;
  data: Uint8ClampedArray; // RGBA, DOC_W*DOC_H*4
}

let frameSeq = 0;
export function newFrameId(): string {
  return `f${Date.now().toString(36)}_${frameSeq++}`;
}

export function blankFrame(durationMs = 100): Frame {
  return { id: newFrameId(), durationMs, data: new Uint8ClampedArray(DOC_W * DOC_H * 4) };
}

export interface ProjectState {
  frames: Frame[];
  layers: OverlayLayer[]; // index 0 = bottom (rendered first)
  current: number;
  setCurrent: (i: number) => void;
  addFrame: () => void;
  duplicateFrame: (i: number) => void;
  deleteFrame: (i: number) => void;
  moveFrame: (i: number, dir: -1 | 1) => void;
  setDuration: (i: number, ms: number) => void;
  commitPixels: (i: number, data: Uint8ClampedArray) => void;
  commitManyPixels: (updates: Map<number, Uint8ClampedArray>) => void;
  addLayer: (layer: OverlayLayer) => void;
  updateLayer: (id: string, patch: Partial<Omit<OverlayLayer, "id" | "keyframes">>) => void;
  removeLayer: (id: string) => void;
  moveLayer: (id: string, dir: -1 | 1) => void; // +1 = toward top (end of array)
  duplicateLayer: (id: string) => string | null;
  setLayerKeyframe: (id: string, kf: Keyframe) => void;
  deleteLayerKeyframe: (id: string, frame: number) => void;
  loadProject: (frames: Frame[], layers: OverlayLayer[], current: number) => void;
}

export const useProject = create<ProjectState>()(
  temporal(
    (set) => ({
      frames: [blankFrame()],
      layers: [],
      current: 0,

      setCurrent: (i) =>
        set((s) => ({ current: Math.max(0, Math.min(i, s.frames.length - 1)) })),

      addFrame: () =>
        set((s) => {
          const frames = [...s.frames];
          frames.splice(s.current + 1, 0, blankFrame(s.frames[s.current]?.durationMs ?? 100));
          const layers = s.layers.map((l) => ({
            ...l,
            keyframes: shiftKeyframesForInsert(l.keyframes, s.current + 1),
          }));
          return { frames, layers, current: s.current + 1 };
        }),

      duplicateFrame: (i) =>
        set((s) => {
          const src = s.frames[i];
          if (!src) return s;
          const copy: Frame = {
            id: newFrameId(),
            durationMs: src.durationMs,
            data: new Uint8ClampedArray(src.data),
          };
          const frames = [...s.frames];
          frames.splice(i + 1, 0, copy);
          const layers = s.layers.map((l) => ({
            ...l,
            keyframes: shiftKeyframesForInsert(l.keyframes, i + 1),
          }));
          return { frames, layers, current: i + 1 };
        }),

      deleteFrame: (i) =>
        set((s) => {
          if (s.frames.length <= 1) return s;
          const frames = s.frames.filter((_, j) => j !== i);
          const layers = s.layers.map((l) => ({
            ...l,
            keyframes: shiftKeyframesForDelete(l.keyframes, i),
          }));
          return { frames, layers, current: Math.min(s.current, frames.length - 1) };
        }),

      moveFrame: (i, dir) =>
        set((s) => {
          const j = i + dir;
          if (i < 0 || i >= s.frames.length || j < 0 || j >= s.frames.length) return s;
          const frames = [...s.frames];
          [frames[i], frames[j]] = [frames[j], frames[i]];
          // swap keyframes riding on the two swapped frame indices
          const layers = s.layers.map((l) => ({
            ...l,
            keyframes: l.keyframes
              .map((k) =>
                k.frame === i ? { ...k, frame: j } : k.frame === j ? { ...k, frame: i } : k
              )
              .sort((a, b) => a.frame - b.frame),
          }));
          return { frames, layers, current: j };
        }),

      setDuration: (i, ms) =>
        set((s) => {
          const frames = [...s.frames];
          if (!frames[i]) return s;
          frames[i] = { ...frames[i], durationMs: Math.max(1, Math.min(65535, Math.round(ms) || 1)) };
          return { frames };
        }),

      commitPixels: (i, data) =>
        set((s) => {
          const frames = [...s.frames];
          if (!frames[i]) return s;
          frames[i] = { ...frames[i], data };
          return { frames };
        }),

      commitManyPixels: (updates) =>
        set((s) => {
          const frames = s.frames.map((f, i) => {
            const d = updates.get(i);
            return d ? { ...f, data: d } : f;
          });
          return { frames };
        }),

      addLayer: (layer) => set((s) => ({ layers: [...s.layers, layer] })),

      updateLayer: (id, patch) =>
        set((s) => ({
          layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        })),

      removeLayer: (id) => set((s) => ({ layers: s.layers.filter((l) => l.id !== id) })),

      moveLayer: (id, dir) =>
        set((s) => {
          const i = s.layers.findIndex((l) => l.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= s.layers.length) return s;
          const layers = [...s.layers];
          [layers[i], layers[j]] = [layers[j], layers[i]];
          return { layers };
        }),

      duplicateLayer: (id) => {
        let newId: string | null = null;
        set((s) => {
          const i = s.layers.findIndex((l) => l.id === id);
          if (i < 0) return s;
          const src = s.layers[i];
          newId = newLayerId();
          const copy: OverlayLayer = {
            ...src,
            id: newId,
            name: `${src.name} copy`,
            keyframes: src.keyframes.map((k) => ({ ...k })),
          };
          const layers = [...s.layers];
          layers.splice(i + 1, 0, copy);
          return { layers };
        });
        return newId;
      },

      setLayerKeyframe: (id, kf) =>
        set((s) => ({
          layers: s.layers.map((l) =>
            l.id === id ? { ...l, keyframes: upsertKeyframe(l.keyframes, kf) } : l
          ),
        })),

      deleteLayerKeyframe: (id, frame) =>
        set((s) => ({
          layers: s.layers.map((l) =>
            l.id === id ? { ...l, keyframes: deleteKeyframe(l.keyframes, frame) } : l
          ),
        })),

      loadProject: (frames, layers, current) =>
        set(() => ({
          frames: frames.length ? frames : [blankFrame()],
          layers,
          current: Math.max(0, Math.min(current, frames.length - 1)),
        })),
    }),
    {
      limit: 64,
      partialize: (s) => ({ frames: s.frames, layers: s.layers }),
      equality: (past, cur) => past.frames === cur.frames && past.layers === cur.layers,
    }
  )
);

// Write a layer's transform at the current frame, honoring auto-key:
// with autoKey (or an existing keyframe here, or no keyframes yet) write/update
// a keyframe at the current frame; otherwise retarget the governing keyframe.
export function writeLayerTransform(
  layerId: string,
  t: { x: number; y: number; scale: number; rotation: number; opacity: number },
  autoKey: boolean
): void {
  const p = useProject.getState();
  const cur = Math.min(p.current, p.frames.length - 1);
  const layer = p.layers.find((l) => l.id === layerId);
  if (!layer) return;
  const existing = layer.keyframes.find((k) => k.frame === cur);
  if (autoKey || existing || layer.keyframes.length === 0) {
    p.setLayerKeyframe(layerId, {
      frame: cur,
      x: t.x,
      y: t.y,
      scale: t.scale,
      rotation: t.rotation,
      opacity: t.opacity,
      easing: existing?.easing ?? "linear",
    });
  } else {
    let gov = layer.keyframes[0];
    for (const k of layer.keyframes) if (k.frame <= cur) gov = k;
    p.setLayerKeyframe(layerId, {
      ...gov,
      x: t.x,
      y: t.y,
      scale: t.scale,
      rotation: t.rotation,
      opacity: t.opacity,
    });
  }
}

export function undo(): void {
  useProject.temporal.getState().undo();
}
export function redo(): void {
  useProject.temporal.getState().redo();
}
