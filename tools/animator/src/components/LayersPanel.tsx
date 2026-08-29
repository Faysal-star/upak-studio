"use client";

import { useState } from "react";
import { ensureBitmaps, getBitmap } from "../lib/bitmaps";
import { drawLayerInto } from "../lib/composite";
import {
  keyframeAt,
  sampleLayerTransform,
  type Easing,
  type OverlayLayer,
} from "../lib/layers";
import { DOC_H, DOC_W, useProject } from "../store/project";
import { useUi } from "../store/ui";
import {
  IconDiamond,
  IconDown,
  IconDuplicate,
  IconEyeClosed,
  IconEyeOpen,
  IconStamp,
  IconTrash,
  IconUp,
} from "./Icons";

const EASINGS: { id: Easing; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "easeInQuad", label: "Ease in" },
  { id: "easeOutQuad", label: "Ease out" },
  { id: "easeInOutQuad", label: "Ease in-out" },
];

async function stampLayer(layer: OverlayLayer, frameIndexes: number[]): Promise<number> {
  await ensureBitmaps([layer]);
  const bmp = getBitmap(layer);
  if (!bmp) return 0;
  const p = useProject.getState();
  const updates = new Map<number, Uint8ClampedArray>();
  for (const i of frameIndexes) {
    const frame = p.frames[i];
    if (!frame) continue;
    const out = new Uint8ClampedArray(frame.data);
    drawLayerInto(out, DOC_W, DOC_H, bmp, sampleLayerTransform(layer, i), layer.opacity);
    updates.set(i, out);
  }
  p.commitManyPixels(updates);
  return updates.size;
}

function LayerRow({ layer, index, count }: { layer: OverlayLayer; index: number; count: number }) {
  const p = useProject();
  const ui = useUi();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(layer.name);
  const selected = ui.selectedLayerId === layer.id;
  const cur = Math.min(p.current, p.frames.length - 1);
  const kf = keyframeAt(layer.keyframes, cur);

  const finishRename = () => {
    setRenaming(false);
    const name = nameDraft.trim();
    if (name && name !== layer.name) p.updateLayer(layer.id, { name });
  };

  return (
    <div
      className={`layerRow${selected ? " selected" : ""}`}
      onClick={() => ui.set({ selectedLayerId: layer.id, tool: "move" })}
    >
      <div className="layerRowMain">
        <button
          className={`iconBtn${layer.visible ? "" : " dim"}`}
          title={layer.visible ? "Hide layer" : "Show layer"}
          onClick={(e) => {
            e.stopPropagation();
            p.updateLayer(layer.id, { visible: !layer.visible });
          }}
        >
          {layer.visible ? <IconEyeOpen /> : <IconEyeClosed />}
        </button>
        {renaming ? (
          <input
            autoFocus
            className="layerNameInput"
            value={nameDraft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={finishRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") finishRename();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <span
            className="layerName"
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setNameDraft(layer.name);
              setRenaming(true);
            }}
          >
            {layer.name}
            <em className="layerType">{layer.type}</em>
          </span>
        )}
        <button
          className="iconBtn"
          title="Move up (toward front)"
          disabled={index === count - 1}
          onClick={(e) => {
            e.stopPropagation();
            p.moveLayer(layer.id, 1);
          }}
        >
          <IconUp />
        </button>
        <button
          className="iconBtn"
          title="Move down (toward back)"
          disabled={index === 0}
          onClick={(e) => {
            e.stopPropagation();
            p.moveLayer(layer.id, -1);
          }}
        >
          <IconDown />
        </button>
      </div>

      <div className="layerRowSub" onClick={(e) => e.stopPropagation()}>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(layer.opacity * 100)}
          title={`Layer opacity ${Math.round(layer.opacity * 100)}%`}
          onChange={(e) => p.updateLayer(layer.id, { opacity: Number(e.target.value) / 100 })}
        />
        <button
          className="iconBtn"
          title="Duplicate layer"
          onClick={() => {
            const id = p.duplicateLayer(layer.id);
            if (id) ui.set({ selectedLayerId: id });
          }}
        >
          <IconDuplicate />
        </button>
        <button
          className="iconBtn"
          title="Stamp into current frame's pixels"
          onClick={async () => {
            await stampLayer(layer, [cur]);
            ui.pushToast("ok", `Stamped "${layer.name}" into frame ${cur + 1}`);
          }}
        >
          <IconStamp />
        </button>
        <button
          className="iconBtn"
          title="Stamp into ALL frames (each at its own sampled transform)"
          onClick={async () => {
            const n = await stampLayer(layer, p.frames.map((_, i) => i));
            ui.pushToast("ok", `Stamped "${layer.name}" into ${n} frames`);
          }}
        >
          <span className="stampAll">
            <IconStamp />
            <b>∀</b>
          </span>
        </button>
        <button
          className="iconBtn danger"
          title="Delete layer"
          onClick={() => {
            p.removeLayer(layer.id);
            if (selected) ui.set({ selectedLayerId: null });
          }}
        >
          <IconTrash />
        </button>
      </div>

      {selected && (
        <div className="layerRowKf" onClick={(e) => e.stopPropagation()}>
          <span className="kfBadge">
            <IconDiamond filled={!!kf} /> frame {cur + 1}
          </span>
          {kf ? (
            <>
              <select
                value={kf.easing}
                title="Easing toward the next keyframe"
                onChange={(e) =>
                  p.setLayerKeyframe(layer.id, { ...kf, easing: e.target.value as Easing })
                }
              >
                {EASINGS.map((ez) => (
                  <option key={ez.id} value={ez.id}>
                    {ez.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={Math.round(kf.opacity * 100)}
                title="Keyframed opacity %"
                onChange={(e) =>
                  p.setLayerKeyframe(layer.id, {
                    ...kf,
                    opacity: Math.max(0, Math.min(100, Number(e.target.value))) / 100,
                  })
                }
              />
              <button
                className="iconBtn"
                title="Delete this keyframe"
                disabled={layer.keyframes.length <= 1}
                onClick={() => p.deleteLayerKeyframe(layer.id, cur)}
              >
                <IconTrash />
              </button>
            </>
          ) : (
            <button
              className="chipBtn"
              title="Add a keyframe here with the current sampled transform"
              onClick={() => {
                const t = sampleLayerTransform(layer, cur);
                p.setLayerKeyframe(layer.id, { frame: cur, ...t, easing: "linear" });
              }}
            >
              + keyframe
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function LayersPanel() {
  const layers = useProject((s) => s.layers);
  const set = useUi((s) => s.set);

  if (layers.length === 0) {
    return (
      <div className="layersEmpty">
        No overlay layers yet.
        <button className="chipBtn" onClick={() => set({ showImport: true, importFiles: [] })}>
          Import an image or SVG
        </button>
      </div>
    );
  }

  // top of the list = front-most = end of the array
  const ordered = [...layers].reverse();
  return (
    <div className="layersList">
      {ordered.map((l) => (
        <LayerRow
          key={l.id}
          layer={l}
          index={layers.findIndex((x) => x.id === l.id)}
          count={layers.length}
        />
      ))}
    </div>
  );
}
