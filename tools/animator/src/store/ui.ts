"use client";

import { create } from "zustand";

export type Tool =
  | "pencil"
  | "eraser"
  | "line"
  | "rect"
  | "ellipse"
  | "fill"
  | "picker"
  | "move"
  | "select"
  | "text";

export const DEFAULT_PALETTE: string[] = [
  "#000000", "#ffffff", "#9d9d9d", "#454545",
  "#e63946", "#f77f00", "#fcbf49", "#8ac926",
  "#2a9d8f", "#00b4d8", "#3a86ff", "#7b2cbf",
  "#ff70a6", "#8d5524", "#f2e8cf", "#14213d",
];

export interface Toast {
  id: number;
  kind: "ok" | "err" | "info";
  msg: string;
}

interface UiState {
  tool: Tool;
  brush: number;
  color: string;
  recent: string[]; // last used colors, most recent first, max 8
  palette: string[]; // editable 16 swatches
  shapeFill: boolean; // filled vs outline for rect/ellipse
  zoom: number;
  grid: boolean;
  onion: boolean;
  playing: boolean;
  dither: boolean;
  animName: string;
  autoKey: boolean;
  selectedLayerId: string | null;
  textEdit: { x: number; y: number } | null; // open text editor at doc position
  textFont: string; // "pixel" | "sans" | "serif" | "mono" | "rounded"
  textSize: number; // px (pixel font: 7/14/21 = ×1/×2/×3)
  textBold: boolean;
  textCrisp: boolean; // binarize alpha at 50% for system fonts
  textAsLayer: boolean; // false = stamp to pixels (default), true = overlay layer
  showShortcuts: boolean;
  showImport: boolean;
  importFiles: File[]; // files pending in the import dialog
  cursor: { x: number; y: number } | null; // doc-space cursor for status bar
  toasts: Toast[];
  set: (p: Partial<UiState>) => void;
  useColor: (c: string) => void; // set color + track in recents
  setPaletteSlot: (i: number, c: string) => void;
  pushToast: (kind: Toast["kind"], msg: string) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;

export const useUi = create<UiState>((set, get) => ({
  tool: "pencil",
  brush: 2,
  color: "#00b4d8",
  recent: [],
  palette: [...DEFAULT_PALETTE],
  shapeFill: false,
  zoom: 3,
  grid: false,
  onion: false,
  playing: false,
  dither: false,
  animName: "demo",
  autoKey: true,
  selectedLayerId: null,
  textEdit: null,
  textFont: "pixel",
  textSize: 14,
  textBold: false,
  textCrisp: true,
  textAsLayer: false,
  showShortcuts: false,
  showImport: false,
  importFiles: [],
  cursor: null,
  toasts: [],
  set: (p) => set(p),

  useColor: (c) => {
    const lc = c.toLowerCase();
    const recent = [lc, ...get().recent.filter((r) => r !== lc)].slice(0, 8);
    set({ color: lc, recent });
  },

  setPaletteSlot: (i, c) =>
    set((s) => {
      const palette = [...s.palette];
      if (i < 0 || i >= palette.length) return s;
      palette[i] = c.toLowerCase();
      return { palette };
    }),

  pushToast: (kind, msg) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, msg }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4500);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
