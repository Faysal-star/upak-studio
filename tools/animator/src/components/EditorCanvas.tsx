"use client";

import { useEffect, useRef, useState } from "react";
import { compositeFrameCached, getBitmap, subscribeBitmaps } from "../lib/bitmaps";
import { flattenFrame } from "../lib/composite";
import {
  constrainLine45,
  constrainSquare,
  ellipseFilled,
  ellipseOutline,
  floodFill,
  hexToRgba,
  line,
  pickColor,
  rectFilled,
  rectOutline,
  rgbaToHex,
  stamp,
  type RGBA,
} from "../lib/draw";
import {
  sampleLayerTransform,
  type OverlayLayer,
  type SampledTransform,
} from "../lib/layers";
import { DOC_H, DOC_W, useProject, writeLayerTransform } from "../store/project";
import {
  commitFloating,
  liftSelection,
  rasterWithFloating,
  useSelection,
} from "../store/selection";
import { useUi } from "../store/ui";
import TextPanel from "./TextPanel";

interface Stroke {
  tool: string;
  base: Uint8ClampedArray;
  work: Uint8ClampedArray;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  shift: boolean;
}

type MoveMode = "translate" | "scale" | "rotate";
interface MoveDrag {
  mode: MoveMode;
  layerId: string;
  start: SampledTransform;
  transient: SampledTransform;
  startPx: number; // doc coords (float)
  startPy: number;
  startDist: number;
  startAngle: number;
}

type SelMode = "marquee" | "dragFloat";
interface SelDrag {
  mode: SelMode;
  startX: number;
  startY: number;
  offX: number; // pointer offset inside floating clip
  offY: number;
}

interface PanDrag {
  startClientX: number;
  startClientY: number;
  scrollL: number;
  scrollT: number;
}

// Forward-transform layer-local point to doc coords.
function fwd(t: SampledTransform, lx: number, ly: number): [number, number] {
  const rad = (t.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [t.x + (lx * c - ly * s) * t.scale, t.y + (lx * s + ly * c) * t.scale];
}

// Inverse-transform doc point to layer-local coords.
function invPt(t: SampledTransform, x: number, y: number): [number, number] {
  const rad = (t.rotation * Math.PI) / 180;
  const c = Math.cos(-rad);
  const s = Math.sin(-rad);
  const ox = x - t.x;
  const oy = y - t.y;
  return [(ox * c - oy * s) / t.scale, (ox * s + oy * c) / t.scale];
}

function layerCorners(layer: OverlayLayer, t: SampledTransform): [number, number][] {
  const hw = layer.naturalW / 2;
  const hh = layer.naturalH / 2;
  return [
    fwd(t, -hw, -hh),
    fwd(t, hw, -hh),
    fwd(t, hw, hh),
    fwd(t, -hw, hh),
  ];
}

export default function EditorCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const onionOffRef = useRef<HTMLCanvasElement | null>(null);
  const strokeRef = useRef<Stroke | null>(null);
  const moveRef = useRef<MoveDrag | null>(null);
  const selRef = useRef<SelDrag | null>(null);
  const panRef = useRef<PanDrag | null>(null);
  const spaceRef = useRef(false);
  const [, force] = useState(0);

  const frames = useProject((s) => s.frames);
  const layers = useProject((s) => s.layers);
  const current = useProject((s) => Math.min(s.current, s.frames.length - 1));
  const zoom = useUi((s) => s.zoom);
  const grid = useUi((s) => s.grid);
  const onion = useUi((s) => s.onion);
  const tool = useUi((s) => s.tool);
  const selectedLayerId = useUi((s) => s.selectedLayerId);
  const textEdit = useUi((s) => s.textEdit);
  const selRect = useSelection((s) => s.rect);
  const floating = useSelection((s) => s.floating);

  // re-render when a layer bitmap finishes decoding
  useEffect(() => subscribeBitmaps(() => force((v) => v + 1)), []);

  // space-held pan flag (window-level so it works regardless of focus)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
        spaceRef.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = "grab";
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        if (canvasRef.current) canvasRef.current.style.cursor = "";
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const render = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const p = useProject.getState();
    const ui = useUi.getState();
    const cur = Math.min(p.current, p.frames.length - 1);
    const frame = p.frames[cur];
    const z = ui.zoom;
    const md = moveRef.current;

    // 1) raster for this frame (stroke-in-progress or floating selection preview)
    const raster = strokeRef.current ? strokeRef.current.work : rasterWithFloating(frame.data);

    // 2) layers, with the drag transient overriding the dragged layer
    let renderLayers = p.layers;
    if (md) {
      renderLayers = p.layers.map((l) =>
        l.id === md.layerId
          ? { ...l, keyframes: [{ frame: cur, ...md.transient, easing: "linear" as const }] }
          : l
      );
    }

    // 3) composite (cached on the calm path, direct while interacting)
    const interacting = !!strokeRef.current || !!useSelection.getState().floating || !!md;
    const composed =
      renderLayers.length === 0
        ? raster
        : interacting || raster !== frame.data
          ? flattenFrame(raster, DOC_W, DOC_H, renderLayers, cur, getBitmap)
          : compositeFrameCached(frame, renderLayers, cur);

    if (!offRef.current) {
      offRef.current = document.createElement("canvas");
      offRef.current.width = DOC_W;
      offRef.current.height = DOC_H;
    }
    offRef.current
      .getContext("2d")!
      .putImageData(new ImageData(new Uint8ClampedArray(composed), DOC_W, DOC_H), 0, 0);

    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;

    // onion skin: previous frame composite underneath
    if (ui.onion && cur > 0 && !ui.playing) {
      if (!onionOffRef.current) {
        onionOffRef.current = document.createElement("canvas");
        onionOffRef.current.width = DOC_W;
        onionOffRef.current.height = DOC_H;
      }
      const prev = compositeFrameCached(p.frames[cur - 1], p.layers, cur - 1);
      onionOffRef.current
        .getContext("2d")!
        .putImageData(new ImageData(new Uint8ClampedArray(prev), DOC_W, DOC_H), 0, 0);
      ctx.globalAlpha = 0.3;
      ctx.drawImage(onionOffRef.current, 0, 0, DOC_W * z, DOC_H * z);
      ctx.globalAlpha = 1;
    }

    ctx.drawImage(offRef.current, 0, 0, DOC_W * z, DOC_H * z);

    if (ui.grid && z >= 4) {
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < DOC_W; x++) {
        ctx.moveTo(x * z + 0.5, 0);
        ctx.lineTo(x * z + 0.5, DOC_H * z);
      }
      for (let y = 1; y < DOC_H; y++) {
        ctx.moveTo(0, y * z + 0.5);
        ctx.lineTo(DOC_W * z, y * z + 0.5);
      }
      ctx.stroke();
    }

    // selection overlay
    const sel = useSelection.getState();
    const overlayRect = sel.floating
      ? { x: sel.floating.x, y: sel.floating.y, w: sel.floating.clip.w, h: sel.floating.clip.h }
      : sel.rect;
    if (overlayRect && ui.tool === "select") {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "#0b0d10";
      ctx.strokeRect(
        overlayRect.x * z + 0.5,
        overlayRect.y * z + 0.5,
        overlayRect.w * z - 1,
        overlayRect.h * z - 1
      );
      ctx.lineDashOffset = 4.5;
      ctx.strokeStyle = sel.floating ? "#ffb454" : "#e8ecf1";
      ctx.strokeRect(
        overlayRect.x * z + 0.5,
        overlayRect.y * z + 0.5,
        overlayRect.w * z - 1,
        overlayRect.h * z - 1
      );
      ctx.restore();
    }

    // text placement marker
    if (ui.tool === "text" && ui.textEdit) {
      const tx = ui.textEdit.x * z;
      const ty = ui.textEdit.y * z;
      ctx.save();
      ctx.strokeStyle = "#ffb454";
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(tx - 6, ty);
      ctx.lineTo(tx + 6, ty);
      ctx.moveTo(tx, ty - 6);
      ctx.lineTo(tx, ty + 6);
      ctx.stroke();
      ctx.restore();
    }

    // move/transform gizmo
    if (ui.tool === "move" && ui.selectedLayerId) {
      const layer = p.layers.find((l) => l.id === ui.selectedLayerId);
      if (layer) {
        const t =
          md && md.layerId === layer.id ? md.transient : sampleLayerTransform(layer, cur);
        const corners = layerCorners(layer, t).map(([x, y]) => [x * z, y * z] as [number, number]);
        ctx.save();
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = "#4f8ef7";
        ctx.beginPath();
        ctx.moveTo(corners[0][0], corners[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1]);
        ctx.closePath();
        ctx.stroke();

        // rotation stem + handle above top-center
        const topMid: [number, number] = [
          (corners[0][0] + corners[1][0]) / 2,
          (corners[0][1] + corners[1][1]) / 2,
        ];
        const cx = t.x * z;
        const cy = t.y * z;
        let dx = topMid[0] - cx;
        let dy = topMid[1] - cy;
        const dd = Math.hypot(dx, dy) || 1;
        dx /= dd;
        dy /= dd;
        const rot: [number, number] = [topMid[0] + dx * 20, topMid[1] + dy * 20];
        ctx.beginPath();
        ctx.moveTo(topMid[0], topMid[1]);
        ctx.lineTo(rot[0], rot[1]);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rot[0], rot[1], 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "#171a1f";
        ctx.fill();
        ctx.stroke();

        // corner scale handles
        for (const [hx, hy] of corners) {
          ctx.fillStyle = "#171a1f";
          ctx.fillRect(hx - 4, hy - 4, 8, 8);
          ctx.strokeRect(hx - 3.5, hy - 3.5, 7, 7);
        }
        ctx.restore();
      }
    }
  };

  useEffect(render);

  // pixel coords (integers) and doc coords (floats)
  const toPx = (e: React.PointerEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const z = useUi.getState().zoom;
    return [Math.floor((e.clientX - rect.left) / z), Math.floor((e.clientY - rect.top) / z)];
  };
  const toDoc = (e: React.PointerEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const z = useUi.getState().zoom;
    return [(e.clientX - rect.left) / z, (e.clientY - rect.top) / z];
  };

  const activeColor = (): RGBA => {
    const ui = useUi.getState();
    return ui.tool === "eraser" ? [0, 0, 0, 0] : hexToRgba(ui.color);
  };

  const commitMoveDrag = () => {
    const md = moveRef.current;
    if (!md) return;
    moveRef.current = null;
    writeLayerTransform(md.layerId, md.transient, useUi.getState().autoKey);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const ui = useUi.getState();
    const p = useProject.getState();
    const cur = Math.min(p.current, p.frames.length - 1);

    // pan: space-drag or middle mouse
    if (spaceRef.current || e.button === 1) {
      const cont = containerRef.current!;
      panRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        scrollL: cont.scrollLeft,
        scrollT: cont.scrollTop,
      };
      (e.target as Element).setPointerCapture(e.pointerId);
      if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
      e.preventDefault();
      return;
    }

    if (e.button !== 0 || ui.playing) return;
    const [x, y] = toPx(e);
    const [fx, fy] = toDoc(e);

    // -------------------------------------------------------- text tool (T)
    if (ui.tool === "text") {
      ui.set({ textEdit: { x, y } });
      return;
    }

    // ------------------------------------------------ move/transform tool (V)
    if (ui.tool === "move") {
      const z = ui.zoom;
      const selLayer = p.layers.find((l) => l.id === ui.selectedLayerId);
      if (selLayer) {
        const t = sampleLayerTransform(selLayer, cur);
        const corners = layerCorners(selLayer, t);
        const hitR = 12 / z; // handle hit radius in doc units (generous)
        // rotation handle
        const topMid: [number, number] = [
          (corners[0][0] + corners[1][0]) / 2,
          (corners[0][1] + corners[1][1]) / 2,
        ];
        let dx = topMid[0] - t.x;
        let dy = topMid[1] - t.y;
        const dd = Math.hypot(dx, dy) || 1;
        const rot: [number, number] = [topMid[0] + (dx / dd) * (20 / z), topMid[1] + (dy / dd) * (20 / z)];
        const startDrag = (mode: MoveMode) => {
          moveRef.current = {
            mode,
            layerId: selLayer.id,
            start: t,
            transient: { ...t },
            startPx: fx,
            startPy: fy,
            startDist: Math.hypot(fx - t.x, fy - t.y),
            startAngle: Math.atan2(fy - t.y, fx - t.x),
          };
          (e.target as Element).setPointerCapture(e.pointerId);
        };
        if (Math.hypot(fx - rot[0], fy - rot[1]) <= hitR) {
          startDrag("rotate");
          return;
        }
        for (const [hx, hy] of corners) {
          if (Math.hypot(fx - hx, fy - hy) <= hitR) {
            startDrag("scale");
            return;
          }
        }
        {
          // generous body hit test: pad transformed bounds by ~6 screen px
          const pad = 6 / (z * Math.max(0.02, t.scale));
          const [lx, ly] = invPt(t, fx, fy);
          if (
            Math.abs(lx) <= selLayer.naturalW / 2 + pad &&
            Math.abs(ly) <= selLayer.naturalH / 2 + pad
          ) {
            startDrag("translate");
            return;
          }
        }
      }
      // click: select topmost layer under cursor, else deselect
      for (let i = p.layers.length - 1; i >= 0; i--) {
        const l = p.layers[i];
        if (!l.visible) continue;
        const t = sampleLayerTransform(l, cur);
        const pad = 6 / (z * Math.max(0.02, t.scale));
        const [lx, ly] = invPt(t, fx, fy);
        if (Math.abs(lx) <= l.naturalW / 2 + pad && Math.abs(ly) <= l.naturalH / 2 + pad) {
          ui.set({ selectedLayerId: l.id, tool: "move" });
          return;
        }
      }
      ui.set({ selectedLayerId: null });
      return;
    }

    // ------------------------------------------------------- rect select (M)
    if (ui.tool === "select") {
      const sel = useSelection.getState();
      if (sel.floating) {
        const f = sel.floating;
        if (x >= f.x && x < f.x + f.clip.w && y >= f.y && y < f.y + f.clip.h) {
          selRef.current = { mode: "dragFloat", startX: x, startY: y, offX: x - f.x, offY: y - f.y };
          (e.target as Element).setPointerCapture(e.pointerId);
          return;
        }
        commitFloating(); // click outside places the floating pixels
        return;
      }
      if (sel.rect && x >= sel.rect.x && x < sel.rect.x + sel.rect.w && y >= sel.rect.y && y < sel.rect.y + sel.rect.h) {
        // lift selection into a floating buffer and drag it
        const f = liftSelection();
        if (f) {
          selRef.current = { mode: "dragFloat", startX: x, startY: y, offX: x - f.x, offY: y - f.y };
          (e.target as Element).setPointerCapture(e.pointerId);
          return;
        }
      }
      sel.set({ rect: null });
      selRef.current = { mode: "marquee", startX: x, startY: y, offX: 0, offY: 0 };
      (e.target as Element).setPointerCapture(e.pointerId);
      return;
    }

    // ------------------------------------------------------ raster tools
    const c = activeColor();
    if (ui.tool !== "eraser" && ui.tool !== "picker") ui.useColor(ui.color);

    if (ui.tool === "fill") {
      const work = new Uint8ClampedArray(p.frames[cur].data);
      floodFill(work, DOC_W, DOC_H, x, y, c);
      p.commitPixels(cur, work);
      return;
    }
    if (ui.tool === "picker") {
      const composed = compositeFrameCached(p.frames[cur], p.layers, cur);
      const px = pickColor(composed, DOC_W, DOC_H, x, y);
      if (px && px[3] > 0) ui.useColor(rgbaToHex(px[0], px[1], px[2]));
      return;
    }

    const base = new Uint8ClampedArray(p.frames[cur].data);
    const work = new Uint8ClampedArray(base);
    const stroke: Stroke = {
      tool: ui.tool,
      base,
      work,
      startX: x,
      startY: y,
      lastX: x,
      lastY: y,
      shift: e.shiftKey,
    };
    strokeRef.current = stroke;
    (e.target as Element).setPointerCapture(e.pointerId);

    if (ui.tool === "pencil" || ui.tool === "eraser" || ui.tool === "line") {
      stamp(work, DOC_W, DOC_H, x, y, ui.brush, c);
    } else if (ui.tool === "rect") {
      if (ui.shapeFill) rectFilled(work, DOC_W, DOC_H, x, y, x, y, c);
      else rectOutline(work, DOC_W, DOC_H, x, y, x, y, ui.brush, c);
    } else if (ui.tool === "ellipse") {
      if (ui.shapeFill) ellipseFilled(work, DOC_W, DOC_H, x, y, x, y, c);
      else ellipseOutline(work, DOC_W, DOC_H, x, y, x, y, ui.brush, c);
    }
    render();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // status-bar cursor
    {
      const [x, y] = toPx(e);
      const ui = useUi.getState();
      if (x >= 0 && x < DOC_W && y >= 0 && y < DOC_H) {
        if (!ui.cursor || ui.cursor.x !== x || ui.cursor.y !== y) ui.set({ cursor: { x, y } });
      } else if (ui.cursor) ui.set({ cursor: null });
    }

    if (panRef.current) {
      const cont = containerRef.current!;
      cont.scrollLeft = panRef.current.scrollL - (e.clientX - panRef.current.startClientX);
      cont.scrollTop = panRef.current.scrollT - (e.clientY - panRef.current.startClientY);
      return;
    }

    // hover cursor feedback (idle only)
    if (!moveRef.current && !selRef.current && !strokeRef.current && !spaceRef.current) {
      const cv = canvasRef.current;
      if (cv) {
        const ui = useUi.getState();
        const p = useProject.getState();
        const cur = Math.min(p.current, p.frames.length - 1);
        let cursor = "";
        if (ui.tool === "move") {
          const [fx, fy] = toDoc(e);
          const z = ui.zoom;
          cursor = "default";
          const selLayer = p.layers.find((l) => l.id === ui.selectedLayerId);
          if (selLayer) {
            const t = sampleLayerTransform(selLayer, cur);
            const corners = layerCorners(selLayer, t);
            const hitR = 12 / z;
            const topMid: [number, number] = [
              (corners[0][0] + corners[1][0]) / 2,
              (corners[0][1] + corners[1][1]) / 2,
            ];
            let hdx = topMid[0] - t.x;
            let hdy = topMid[1] - t.y;
            const hdd = Math.hypot(hdx, hdy) || 1;
            const rot: [number, number] = [
              topMid[0] + (hdx / hdd) * (20 / z),
              topMid[1] + (hdy / hdd) * (20 / z),
            ];
            if (Math.hypot(fx - rot[0], fy - rot[1]) <= hitR) cursor = "grab";
            else if (corners.some(([hx, hy]) => Math.hypot(fx - hx, fy - hy) <= hitR))
              cursor = "nwse-resize";
            else {
              const pad = 6 / (z * Math.max(0.02, t.scale));
              const [lx, ly] = invPt(t, fx, fy);
              if (
                Math.abs(lx) <= selLayer.naturalW / 2 + pad &&
                Math.abs(ly) <= selLayer.naturalH / 2 + pad
              )
                cursor = "move";
            }
          }
          if (cursor === "default") {
            // any other layer under the cursor -> show it's clickable
            for (let i = p.layers.length - 1; i >= 0; i--) {
              const l = p.layers[i];
              if (!l.visible || l.id === ui.selectedLayerId) continue;
              const t = sampleLayerTransform(l, cur);
              const pad = 6 / (z * Math.max(0.02, t.scale));
              const [lx, ly] = invPt(t, fx, fy);
              if (Math.abs(lx) <= l.naturalW / 2 + pad && Math.abs(ly) <= l.naturalH / 2 + pad) {
                cursor = "pointer";
                break;
              }
            }
          }
        } else if (ui.tool === "select") {
          const [x, y] = toPx(e);
          const sel = useSelection.getState();
          const over = sel.floating
            ? x >= sel.floating.x &&
              x < sel.floating.x + sel.floating.clip.w &&
              y >= sel.floating.y &&
              y < sel.floating.y + sel.floating.clip.h
            : sel.rect
              ? x >= sel.rect.x &&
                x < sel.rect.x + sel.rect.w &&
                y >= sel.rect.y &&
                y < sel.rect.y + sel.rect.h
              : false;
          cursor = over ? "move" : "cell";
        }
        cv.style.cursor = cursor;
      }
    }

    const md = moveRef.current;
    if (md) {
      const [fx, fy] = toDoc(e);
      const t = md.transient;
      if (md.mode === "translate") {
        t.x = md.start.x + (fx - md.startPx);
        t.y = md.start.y + (fy - md.startPy);
        if (e.shiftKey) {
          // axis lock
          if (Math.abs(t.x - md.start.x) > Math.abs(t.y - md.start.y)) t.y = md.start.y;
          else t.x = md.start.x;
        }
      } else if (md.mode === "scale") {
        const d = Math.hypot(fx - md.start.x, fy - md.start.y);
        t.scale = Math.max(0.02, md.start.scale * (d / Math.max(0.001, md.startDist)));
      } else {
        const a = Math.atan2(fy - md.start.y, fx - md.start.x);
        let deg = md.start.rotation + ((a - md.startAngle) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        t.rotation = deg;
      }
      render();
      return;
    }

    const sd = selRef.current;
    if (sd) {
      const [x, y] = toPx(e);
      const sel = useSelection.getState();
      if (sd.mode === "marquee") {
        const x0 = Math.max(0, Math.min(sd.startX, x));
        const y0 = Math.max(0, Math.min(sd.startY, y));
        const x1 = Math.min(DOC_W - 1, Math.max(sd.startX, x));
        const y1 = Math.min(DOC_H - 1, Math.max(sd.startY, y));
        sel.set({ rect: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } });
      } else if (sel.floating) {
        sel.set({ floating: { ...sel.floating, x: x - sd.offX, y: y - sd.offY } });
      }
      render();
      return;
    }

    const stroke = strokeRef.current;
    if (!stroke) return;
    const ui = useUi.getState();
    let [x, y] = toPx(e);
    const c = activeColor();

    if (stroke.tool === "pencil" || stroke.tool === "eraser") {
      line(stroke.work, DOC_W, DOC_H, stroke.lastX, stroke.lastY, x, y, ui.brush, c);
      stroke.lastX = x;
      stroke.lastY = y;
    } else {
      stroke.work.set(stroke.base);
      if (stroke.tool === "line") {
        if (e.shiftKey) [x, y] = constrainLine45(stroke.startX, stroke.startY, x, y);
        line(stroke.work, DOC_W, DOC_H, stroke.startX, stroke.startY, x, y, ui.brush, c);
      } else if (stroke.tool === "rect") {
        if (e.shiftKey) [x, y] = constrainSquare(stroke.startX, stroke.startY, x, y);
        if (ui.shapeFill) rectFilled(stroke.work, DOC_W, DOC_H, stroke.startX, stroke.startY, x, y, c);
        else rectOutline(stroke.work, DOC_W, DOC_H, stroke.startX, stroke.startY, x, y, ui.brush, c);
      } else if (stroke.tool === "ellipse") {
        if (e.shiftKey) [x, y] = constrainSquare(stroke.startX, stroke.startY, x, y);
        if (ui.shapeFill) ellipseFilled(stroke.work, DOC_W, DOC_H, stroke.startX, stroke.startY, x, y, c);
        else ellipseOutline(stroke.work, DOC_W, DOC_H, stroke.startX, stroke.startY, x, y, ui.brush, c);
      }
    }
    render();
  };

  const onPointerUp = () => {
    if (panRef.current) {
      panRef.current = null;
      if (canvasRef.current) canvasRef.current.style.cursor = spaceRef.current ? "grab" : "";
      return;
    }
    if (moveRef.current) {
      commitMoveDrag();
      return;
    }
    if (selRef.current) {
      const sd = selRef.current;
      selRef.current = null;
      if (sd.mode === "marquee") {
        const sel = useSelection.getState();
        if (sel.rect && (sel.rect.w < 2 || sel.rect.h < 2)) sel.set({ rect: null });
      }
      render();
      return;
    }
    const stroke = strokeRef.current;
    if (!stroke) return;
    strokeRef.current = null;
    const p = useProject.getState();
    p.commitPixels(Math.min(p.current, p.frames.length - 1), stroke.work);
  };

  const toolCursor =
    tool === "move"
      ? "default"
      : tool === "select"
        ? "cell"
        : tool === "picker"
          ? "copy"
          : tool === "text"
            ? "text"
            : "crosshair";

  return (
    <div
      className="canvasArea"
      ref={containerRef}
      onPointerLeave={() => useUi.getState().set({ cursor: null })}
    >
      <canvas
        ref={canvasRef}
        className="editorCanvas"
        style={{ cursor: toolCursor }}
        width={DOC_W * zoom}
        height={DOC_H * zoom}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      {textEdit && <TextPanel />}
    </div>
  );
}
