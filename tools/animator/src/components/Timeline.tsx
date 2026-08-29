"use client";

import { useEffect, useRef, useState } from "react";
import { compositeFrameCached, subscribeBitmaps } from "../lib/bitmaps";
import { keyframeAt, sampleLayerTransform, type OverlayLayer } from "../lib/layers";
import { DOC_H, DOC_W, useProject, type Frame } from "../store/project";
import { useUi } from "../store/ui";
import { IconDiamond, IconDuplicate, IconPause, IconPlay, IconPlus, IconTrash } from "./Icons";

const THUMB = 52;

function FrameThumb({ frame, index }: { frame: Frame; index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const layers = useProject((s) => s.layers);
  const [, force] = useState(0);
  useEffect(() => subscribeBitmaps(() => force((v) => v + 1)), []);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const data = compositeFrameCached(frame, layers, index);
    const tmp = document.createElement("canvas");
    tmp.width = DOC_W;
    tmp.height = DOC_H;
    tmp
      .getContext("2d")!
      .putImageData(new ImageData(new Uint8ClampedArray(data), DOC_W, DOC_H), 0, 0);
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, THUMB, THUMB);
    ctx.drawImage(tmp, 0, 0, THUMB, THUMB);
  });
  return <canvas ref={ref} width={THUMB} height={THUMB} />;
}

function KeyframeRow({ layer }: { layer: OverlayLayer }) {
  const p = useProject();
  const ui = useUi();
  const frames = p.frames;
  const selected = ui.selectedLayerId === layer.id;
  return (
    <div className={`kfRow${selected ? " selected" : ""}`}>
      {frames.map((f, i) => {
        const kf = keyframeAt(layer.keyframes, i);
        return (
          <button
            key={f.id}
            className={`kfCell${kf ? " has" : ""}`}
            title={
              kf
                ? `Keyframe @ frame ${i + 1} — click to jump, right-click to delete`
                : `Frame ${i + 1}`
            }
            onClick={() => {
              p.setCurrent(i);
              ui.set({ selectedLayerId: layer.id, tool: "move" });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (kf) p.deleteLayerKeyframe(layer.id, i);
            }}
          >
            {kf ? <IconDiamond filled /> : <span className="kfDotSpace" />}
          </button>
        );
      })}
    </div>
  );
}

export default function Timeline() {
  const frames = useProject((s) => s.frames);
  const layers = useProject((s) => s.layers);
  const current = useProject((s) => Math.min(s.current, s.frames.length - 1));
  const playing = useUi((s) => s.playing);
  const selectedLayerId = useUi((s) => s.selectedLayerId);
  const set = useUi((s) => s.set);

  // playback: honors per-frame durations, loops
  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const p = useProject.getState();
      const cur = Math.min(p.current, p.frames.length - 1);
      timer = setTimeout(() => {
        if (cancelled) return;
        const s = useProject.getState();
        s.setCurrent((Math.min(s.current, s.frames.length - 1) + 1) % s.frames.length);
        step();
      }, p.frames[cur].durationMs);
    };
    step();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [playing]);

  const p = useProject.getState();
  const orderedLayers = [...layers].reverse(); // top of list = front-most

  return (
    <div className="timeline">
      <div className="timelineLeft">
        <div className="timelineControls">
          <button
            className={`btn btnIcon${playing ? " active" : ""}`}
            title="Play / pause (Enter)"
            onClick={() => set({ playing: !playing })}
          >
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button className="btn btnIcon" title="Add blank frame after current" onClick={() => p.addFrame()}>
            <IconPlus />
          </button>
          <button
            className="btn btnIcon"
            title="Duplicate current frame"
            onClick={() => p.duplicateFrame(current)}
          >
            <IconDuplicate />
          </button>
          <button
            className="btn btnIcon"
            title="Delete current frame"
            disabled={frames.length <= 1}
            onClick={() => p.deleteFrame(current)}
          >
            <IconTrash />
          </button>
          <button
            className="btn btnIcon"
            title="Move frame left"
            disabled={current === 0}
            onClick={() => p.moveFrame(current, -1)}
          >
            ←
          </button>
          <button
            className="btn btnIcon"
            title="Move frame right"
            disabled={current === frames.length - 1}
            onClick={() => p.moveFrame(current, 1)}
          >
            →
          </button>
        </div>
        <div className="timelineLayerLabels">
          {orderedLayers.map((l) => (
            <div
              key={l.id}
              className={`kfLabel${selectedLayerId === l.id ? " selected" : ""}`}
              title={l.name}
              onClick={() => set({ selectedLayerId: l.id, tool: "move" })}
            >
              <span className="kfLabelName">{l.name}</span>
              <button
                className="iconBtn"
                title="Add/refresh keyframe at current frame"
                onClick={(e) => {
                  e.stopPropagation();
                  const t = sampleLayerTransform(l, current);
                  const existing = keyframeAt(l.keyframes, current);
                  p.setLayerKeyframe(l.id, {
                    frame: current,
                    ...t,
                    easing: existing?.easing ?? "linear",
                  });
                }}
              >
                <IconDiamond />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="timelineScroll">
        <div className="frameStrip">
          {frames.map((f, i) => (
            <div
              key={f.id}
              className={`frameChip${i === current ? " active" : ""}`}
              onClick={() => p.setCurrent(i)}
            >
              <FrameThumb frame={f} index={i} />
              <div className="chipMeta">
                <span className="idx">{i + 1}</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={f.durationMs}
                  title="Frame duration (ms)"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => p.setDuration(i, Number(e.target.value))}
                />
              </div>
            </div>
          ))}
        </div>
        {orderedLayers.map((l) => (
          <KeyframeRow key={l.id} layer={l} />
        ))}
      </div>
    </div>
  );
}
