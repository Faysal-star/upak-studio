"use client";

// Rect-select tool state, shared between the canvas (mouse) and the global
// keyboard handler (Ctrl+C/X/V, Delete, arrows, Enter, Esc). Not undo-tracked —
// commits go through useProject.commitPixels.

import { create } from "zustand";
import { blitClip, clearRect, extractRect, type Clip, type SelRect } from "../lib/selection";
import { DOC_H, DOC_W, useProject } from "./project";
import { useUi } from "./ui";

export interface Floating {
  clip: Clip;
  x: number;
  y: number;
  base: Uint8ClampedArray; // raster of the SOURCE frame underneath the floating pixels
  frameIndex: number; // frame the floating selection belongs to (base matches it)
}

interface SelectionState {
  rect: SelRect | null;
  floating: Floating | null;
  clipboard: Clip | null;
  set: (p: Partial<Pick<SelectionState, "rect" | "floating" | "clipboard">>) => void;
  clearAll: () => void;
}

export const useSelection = create<SelectionState>((set) => ({
  rect: null,
  floating: null,
  clipboard: null,
  set: (p) => set(p),
  clearAll: () => set({ rect: null, floating: null }),
}));

function currentFrame() {
  const p = useProject.getState();
  const cur = Math.min(p.current, p.frames.length - 1);
  return { p, cur, frame: p.frames[cur] };
}

// Copy works on a floating selection too (drag-move then Ctrl+C just works).
export function copySelection(): boolean {
  const s = useSelection.getState();
  if (s.floating) {
    const f = s.floating;
    s.set({
      clipboard: {
        data: new Uint8ClampedArray(f.clip.data),
        w: f.clip.w,
        h: f.clip.h,
        srcX: f.x,
        srcY: f.y,
      },
    });
    return true;
  }
  if (!s.rect) return false;
  const { frame } = currentFrame();
  s.set({ clipboard: extractRect(frame.data, DOC_W, DOC_H, s.rect) });
  return true;
}

export function cutSelection(): boolean {
  const s = useSelection.getState();
  if (s.floating) {
    // capture the floating pixels, drop them, restore the base underneath
    const f = s.floating;
    const clip: Clip = {
      data: new Uint8ClampedArray(f.clip.data),
      w: f.clip.w,
      h: f.clip.h,
      srcX: f.x,
      srcY: f.y,
    };
    const p = useProject.getState();
    if (p.frames[f.frameIndex]) p.commitPixels(f.frameIndex, new Uint8ClampedArray(f.base));
    s.set({ clipboard: clip, floating: null });
    return true;
  }
  if (!s.rect) return false;
  const { p, cur, frame } = currentFrame();
  const clip = extractRect(frame.data, DOC_W, DOC_H, s.rect);
  const work = new Uint8ClampedArray(frame.data);
  clearRect(work, DOC_W, DOC_H, s.rect);
  p.commitPixels(cur, work);
  s.set({ clipboard: clip, rect: null });
  return true;
}

// Paste -> floating selection at the SOURCE position (crucial for frame-by-frame
// animation: copy on frame 1, paste on frame 2 lands in the same spot).
// Committed on Enter/click-out.
export function pasteClipboard(): boolean {
  const { clipboard } = useSelection.getState();
  if (!clipboard || clipboard.w === 0) return false;
  commitFloating(); // an existing floating selection is placed first
  const { cur, frame } = currentFrame();
  const x = clipboard.srcX ?? Math.round((DOC_W - clipboard.w) / 2);
  const y = clipboard.srcY ?? Math.round((DOC_H - clipboard.h) / 2);
  useSelection.getState().set({
    rect: null,
    floating: {
      clip: clipboard,
      x,
      y,
      base: new Uint8ClampedArray(frame.data),
      frameIndex: cur,
    },
  });
  return true;
}

export function deleteSelection(): boolean {
  const s = useSelection.getState();
  if (s.floating) {
    // drop floating pixels, restore the base underneath
    const f = s.floating;
    const p = useProject.getState();
    if (p.frames[f.frameIndex]) p.commitPixels(f.frameIndex, new Uint8ClampedArray(f.base));
    s.set({ floating: null });
    return true;
  }
  if (!s.rect) return false;
  const { p, cur, frame } = currentFrame();
  const work = new Uint8ClampedArray(frame.data);
  clearRect(work, DOC_W, DOC_H, s.rect);
  p.commitPixels(cur, work);
  s.set({ rect: null });
  return true;
}

// Lift the marquee'd pixels into a floating buffer (drag/nudge moves them).
export function liftSelection(): Floating | null {
  const s = useSelection.getState();
  if (s.floating) return s.floating;
  if (!s.rect) return null;
  const { cur, frame } = currentFrame();
  const clip = extractRect(frame.data, DOC_W, DOC_H, s.rect);
  if (clip.w === 0) return null;
  const base = new Uint8ClampedArray(frame.data);
  clearRect(base, DOC_W, DOC_H, s.rect);
  const f: Floating = { clip, x: clip.srcX ?? s.rect.x, y: clip.srcY ?? s.rect.y, base, frameIndex: cur };
  s.set({ floating: f, rect: null });
  return f;
}

// Nudge the selection: floating moves directly; a plain marquee is lifted first
// so the pixels travel with it. Returns false when there is nothing to nudge.
export function nudgeSelection(dx: number, dy: number): boolean {
  const s = useSelection.getState();
  const f = s.floating ?? liftSelection();
  if (!f) return false;
  useSelection.getState().set({ floating: { ...f, x: f.x + dx, y: f.y + dy } });
  return true;
}

export function commitFloating(): boolean {
  const s = useSelection.getState();
  if (!s.floating) return false;
  const f = s.floating;
  const p = useProject.getState();
  if (!p.frames[f.frameIndex]) {
    s.set({ floating: null });
    return false;
  }
  const out = new Uint8ClampedArray(f.base);
  blitClip(out, DOC_W, DOC_H, f.clip, f.x, f.y);
  p.commitPixels(f.frameIndex, out);
  s.set({
    floating: null,
    rect: { x: f.x, y: f.y, w: f.clip.w, h: f.clip.h },
  });
  return true;
}

export function cancelFloating(): boolean {
  const s = useSelection.getState();
  if (!s.floating) return false;
  s.set({ floating: null });
  return true;
}

// Raster to display for the current frame while a floating selection exists.
// The floating preview only applies on its own frame.
export function rasterWithFloating(frameData: Uint8ClampedArray): Uint8ClampedArray {
  const s = useSelection.getState();
  const p = useProject.getState();
  const cur = Math.min(p.current, p.frames.length - 1);
  if (!s.floating || s.floating.frameIndex !== cur) return frameData;
  const out = new Uint8ClampedArray(s.floating.base);
  blitClip(out, DOC_W, DOC_H, s.floating.clip, s.floating.x, s.floating.y);
  return out;
}

// Safety net: a floating selection is pinned to its source frame. When the
// current frame changes (,/. keys, timeline clicks, playback) commit it to the
// frame it came from so its pixels are never lost or blitted onto the wrong
// frame. The marquee rect itself survives frame switches on purpose.
let lastFrame = -1;
useProject.subscribe((state) => {
  const cur = Math.min(state.current, state.frames.length - 1);
  if (cur !== lastFrame) {
    lastFrame = cur;
    const f = useSelection.getState().floating;
    if (f && f.frameIndex !== cur) commitFloating();
  }
});

// Switching away from the select tool places any floating pixels (they would
// otherwise be invisible and lost).
useUi.subscribe((state, prev) => {
  if (state.tool !== prev.tool && prev.tool === "select") commitFloating();
});
