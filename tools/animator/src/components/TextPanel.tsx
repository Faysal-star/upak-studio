"use client";

// Floating text editor for the Text tool (T). Opens where the canvas was
// clicked; Enter commits, Esc cancels. Two placement modes:
//  - Stamp to pixels (default): rasterize into the current frame's raster.
//  - As layer: PNG overlay layer with the usual move/scale/rotate gizmo and
//    keyframe tweening. Text is not re-editable after creation (v1).

import { useEffect, useMemo, useRef, useState } from "react";
import { newLayerId, type OverlayLayer } from "../lib/layers";
import { blendClip, blitClip } from "../lib/selection";
import { clipToDataUrl, pixelScaleForSize, rasterizeText, TEXT_FONTS } from "../lib/textRender";
import { DOC_H, DOC_W, useProject } from "../store/project";
import { useUi } from "../store/ui";

const PIXEL_SIZES = [7, 14, 21]; // ×1 / ×2 / ×3
const SYS_SIZES = [8, 10, 12, 14, 18, 24, 32, 48];

export default function TextPanel() {
  const ui = useUi();
  const edit = ui.textEdit;
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const isPixel = ui.textFont === "pixel";

  // reset text each time the editor opens, focus the input
  useEffect(() => {
    if (edit) {
      setText("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [edit]);

  const clip = useMemo(() => {
    if (!edit || !text) return null;
    return rasterizeText({
      text,
      font: ui.textFont,
      size: ui.textSize,
      bold: ui.textBold,
      color: ui.color,
      crisp: ui.textCrisp,
    });
  }, [edit, text, ui.textFont, ui.textSize, ui.textBold, ui.color, ui.textCrisp]);

  // live preview swatch
  useEffect(() => {
    const cv = previewRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!clip || clip.w === 0) return;
    const tmp = document.createElement("canvas");
    tmp.width = clip.w;
    tmp.height = clip.h;
    tmp.getContext("2d")!.putImageData(
      new ImageData(new Uint8ClampedArray(clip.data), clip.w, clip.h),
      0,
      0
    );
    const s = Math.min(2, (cv.width - 8) / clip.w, (cv.height - 8) / clip.h);
    const dw = clip.w * s;
    const dh = clip.h * s;
    ctx.imageSmoothingEnabled = s >= 1 ? false : true;
    ctx.drawImage(tmp, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
  }, [clip]);

  if (!edit) return null;

  const close = () => ui.set({ textEdit: null });

  const commit = () => {
    if (!clip || clip.w === 0) {
      close();
      return;
    }
    const p = useProject.getState();
    const cur = Math.min(p.current, p.frames.length - 1);
    if (ui.textAsLayer) {
      const layer: OverlayLayer = {
        id: newLayerId(),
        name: text.length > 24 ? `${text.slice(0, 24)}…` : text,
        type: "image",
        src: clipToDataUrl(clip),
        naturalW: clip.w,
        naturalH: clip.h,
        visible: true,
        opacity: 1,
        keyframes: [
          {
            frame: cur,
            x: Math.min(DOC_W, Math.max(0, edit.x + clip.w / 2)),
            y: Math.min(DOC_H, Math.max(0, edit.y + clip.h / 2)),
            scale: 1,
            rotation: 0,
            opacity: 1,
            easing: "linear",
          },
        ],
      };
      p.addLayer(layer);
      ui.set({ textEdit: null, tool: "move", selectedLayerId: layer.id });
      ui.pushToast("ok", "Text layer added — V to move/scale/rotate (not re-editable)");
    } else {
      const work = new Uint8ClampedArray(p.frames[cur].data);
      const crisp = isPixel || ui.textCrisp;
      if (crisp) blitClip(work, DOC_W, DOC_H, clip, edit.x, edit.y);
      else blendClip(work, DOC_W, DOC_H, clip, edit.x, edit.y);
      p.commitPixels(cur, work);
      close();
    }
  };

  const sizes = isPixel ? PIXEL_SIZES : SYS_SIZES;

  return (
    <div className="textPanel" onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="textPanelInput"
        type="text"
        placeholder="Type text… (Enter = place, Esc = cancel)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      />
      <div className="textPanelRow">
        <select
          value={ui.textFont}
          onChange={(e) => {
            const font = e.target.value;
            const size =
              font === "pixel"
                ? PIXEL_SIZES[Math.max(0, Math.min(2, pixelScaleForSize(ui.textSize) - 1))]
                : ui.textSize;
            ui.set({ textFont: font, textSize: size });
          }}
        >
          {TEXT_FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          value={String(sizes.includes(ui.textSize) ? ui.textSize : sizes[1] ?? sizes[0])}
          onChange={(e) => ui.set({ textSize: Number(e.target.value) })}
        >
          {sizes.map((s) => (
            <option key={s} value={s}>
              {isPixel ? `×${s / 7} (${s}px)` : `${s}px`}
            </option>
          ))}
        </select>
        {!isPixel && (
          <label className="textPanelCheck" title="Bold">
            <input
              type="checkbox"
              checked={ui.textBold}
              onChange={(e) => ui.set({ textBold: e.target.checked })}
            />
            B
          </label>
        )}
        {!isPixel && (
          <label
            className="textPanelCheck"
            title="Binarize edges (no anti-aliasing) — keeps small text sharp on the 240×240 display"
          >
            <input
              type="checkbox"
              checked={ui.textCrisp}
              onChange={(e) => ui.set({ textCrisp: e.target.checked })}
            />
            crisp
          </label>
        )}
      </div>
      <div className="textPanelRow">
        <div className="segmented textPanelMode">
          <button
            className={!ui.textAsLayer ? "active" : ""}
            title="Rasterize into the current frame's pixels"
            onClick={() => ui.set({ textAsLayer: false })}
          >
            Stamp pixels
          </button>
          <button
            className={ui.textAsLayer ? "active" : ""}
            title="Create an overlay layer (move/scale/rotate + tweening; not re-editable)"
            onClick={() => ui.set({ textAsLayer: true })}
          >
            As layer
          </button>
        </div>
      </div>
      <canvas ref={previewRef} className="textPanelPreview" width={228} height={54} />
      <div className="textPanelRow textPanelActions">
        <span className="textPanelHint">
          at {edit.x},{edit.y}
        </span>
        <button className="btn" onClick={close}>
          Cancel
        </button>
        <button className="btn btnPrimary" disabled={!clip} onClick={commit}>
          Place
        </button>
      </div>
    </div>
  );
}
