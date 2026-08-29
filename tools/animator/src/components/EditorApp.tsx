"use client";

import { useEffect, useRef, useState } from "react";
import { sampleLayerTransform } from "../lib/layers";
import { loadProject, saveProject } from "../lib/persist";
import { redo, undo, useProject, writeLayerTransform } from "../store/project";
import {
  cancelFloating,
  commitFloating,
  copySelection,
  cutSelection,
  deleteSelection,
  nudgeSelection,
  pasteClipboard,
  useSelection,
} from "../store/selection";
import { useUi, type Tool } from "../store/ui";
import EditorCanvas from "./EditorCanvas";
import { triggerSend } from "./ExportPanel";
import HintBar from "./HintBar";
import ImportDialog from "./ImportDialog";
import RightPanel from "./RightPanel";
import ShortcutsOverlay from "./ShortcutsOverlay";
import StatusBar from "./StatusBar";
import Timeline from "./Timeline";
import Toasts from "./Toasts";
import ToolOptions, { BRUSH_SIZES } from "./ToolOptions";
import ToolRail from "./ToolRail";
import TopBar from "./TopBar";

const TOOL_KEYS: Record<string, Tool> = {
  b: "pencil",
  e: "eraser",
  l: "line",
  r: "rect",
  o: "ellipse",
  g: "fill",
  i: "picker",
  v: "move",
  m: "select",
  t: "text",
};

const ARROWS: Record<string, [number, number]> = {
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  arrowdown: [0, 1],
};

const IMAGE_TYPES = /^image\/(png|jpeg|webp|svg\+xml)$/;

// dev/debug hook (harmless in prod; used by browser smoke tests)
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__dpStores = {
    useProject,
    useUi,
    useSelection,
  };
}

export default function EditorApp() {
  const loaded = useRef(false);
  const [dragOver, setDragOver] = useState(false);

  // restore autosave once, then autosave (debounced) on any change
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      const saved = loadProject();
      if (saved) {
        useProject.getState().loadProject(saved.frames, saved.layers, saved.current);
        useUi.getState().set({ animName: saved.animName });
        useProject.temporal.getState().clear();
      }
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSave = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const p = useProject.getState();
        saveProject(
          p.frames,
          p.layers,
          Math.min(p.current, p.frames.length - 1),
          useUi.getState().animName
        );
      }, 800);
    };
    const unsubA = useProject.subscribe(scheduleSave);
    const unsubB = useUi.subscribe((s, prev) => {
      if (s.animName !== prev.animName) scheduleSave();
    });
    return () => {
      unsubA();
      unsubB();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        return;
      const ui = useUi.getState();
      const p = useProject.getState();
      const key = e.key.toLowerCase();

      if (e.ctrlKey || e.metaKey) {
        if (key === "z") {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        } else if (key === "y") {
          e.preventDefault();
          redo();
        } else if (key === "c") {
          if (copySelection()) e.preventDefault();
        } else if (key === "x") {
          if (cutSelection()) e.preventDefault();
        } else if (key === "v") {
          // paste of internal selection clipboard; image paste handled by onPaste.
          // Works from any tool (switches to M) so the copy→frame→paste loop flows.
          if (useSelection.getState().clipboard && ui.tool !== "move") {
            if (pasteClipboard()) {
              if (ui.tool !== "select") ui.set({ tool: "select" });
              e.preventDefault();
            }
          }
        }
        return;
      }

      if (key === "escape") {
        if (ui.textEdit) {
          ui.set({ textEdit: null });
          return;
        }
        if (cancelFloating()) return;
        if (useSelection.getState().rect) {
          useSelection.getState().set({ rect: null });
          return;
        }
        if (ui.showShortcuts || ui.showImport) {
          ui.set({ showShortcuts: false, showImport: false });
          return;
        }
        if (ui.selectedLayerId) ui.set({ selectedLayerId: null });
        return;
      }
      if (key === "enter") {
        if (commitFloating()) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        ui.set({ playing: !ui.playing });
        return;
      }
      if (key === "delete" || key === "backspace") {
        if (deleteSelection()) e.preventDefault();
        return;
      }
      if (ARROWS[key]) {
        const [dx, dy] = ARROWS[key];
        const step = e.shiftKey ? 8 : 1;
        if (ui.tool === "select") {
          // nudge the marquee/floating pixels
          if (nudgeSelection(dx * step, dy * step)) {
            e.preventDefault();
            return;
          }
        } else if (ui.tool === "move" && ui.selectedLayerId) {
          // nudge the selected layer (writes/updates keyframe per auto-key)
          const layer = p.layers.find((l) => l.id === ui.selectedLayerId);
          if (layer) {
            const cur = Math.min(p.current, p.frames.length - 1);
            const t = sampleLayerTransform(layer, cur);
            writeLayerTransform(layer.id, { ...t, x: t.x + dx * step, y: t.y + dy * step }, ui.autoKey);
            e.preventDefault();
            return;
          }
        }
        return;
      }
      if (TOOL_KEYS[key] && !e.altKey) {
        ui.set({ tool: TOOL_KEYS[key] });
        return;
      }
      if (key === "[" || key === "]") {
        const i = BRUSH_SIZES.indexOf(ui.brush);
        const j = Math.max(0, Math.min(BRUSH_SIZES.length - 1, i + (key === "]" ? 1 : -1)));
        ui.set({ brush: BRUSH_SIZES[j] });
        return;
      }
      if (key === ",") {
        p.setCurrent(Math.min(p.current, p.frames.length - 1) - 1);
        return;
      }
      if (key === ".") {
        p.setCurrent(Math.min(p.current, p.frames.length - 1) + 1);
        return;
      }
      if (key === "?") {
        ui.set({ showShortcuts: !ui.showShortcuts });
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl+V of an actual image from the OS clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const files: File[] = [];
      for (const item of Array.from(e.clipboardData?.items ?? [])) {
        if (item.kind === "file" && IMAGE_TYPES.test(item.type)) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        useUi.getState().set({ showImport: true, importFiles: files });
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // drag & drop import
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => IMAGE_TYPES.test(f.type) || /\.svg$/i.test(f.name)
    );
    if (files.length) useUi.getState().set({ showImport: true, importFiles: files });
    else useUi.getState().pushToast("err", "Drop PNG, JPG, WebP or SVG files");
  };

  return (
    <div
      className={`app${dragOver ? " dragOver" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <TopBar onSend={() => void triggerSend()} />
      <div className="workspace">
        <ToolRail />
        <ToolOptions />
        <EditorCanvas />
        <RightPanel />
      </div>
      <HintBar />
      <Timeline />
      <StatusBar />
      <ImportDialog />
      <ShortcutsOverlay />
      <Toasts />
      {dragOver && <div className="dropHint">Drop to import</div>}
    </div>
  );
}
