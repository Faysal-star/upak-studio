"use client";

import { useRef, useState } from "react";
import { containScale, fileToAsset, rasterizeToPixels, type FitMode } from "../lib/bitmaps";
import { newLayerId } from "../lib/layers";
import { DOC_H, DOC_W, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { IconClose } from "./Icons";

const ACCEPT = ".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml";

export default function ImportDialog() {
  const show = useUi((s) => s.showImport);
  const files = useUi((s) => s.importFiles);
  const set = useUi((s) => s.set);
  const pushToast = useUi((s) => s.pushToast);
  const [mode, setMode] = useState<"layer" | "pixels">("layer");
  const [fit, setFit] = useState<FitMode>("contain");
  const [smoothing, setSmoothing] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!show) return null;

  const close = () => set({ showImport: false, importFiles: [] });

  const doImport = async (list: File[]) => {
    if (list.length === 0) {
      fileInput.current?.click();
      return;
    }
    setBusy(true);
    const p = useProject.getState();
    const cur = Math.min(p.current, p.frames.length - 1);
    let ok = 0;
    let lastLayerId: string | null = null;
    for (const file of list) {
      try {
        const asset = await fileToAsset(file);
        if (mode === "pixels") {
          const frame = useProject.getState().frames[cur];
          const data = await rasterizeToPixels(asset, frame.data, fit, smoothing);
          useProject.getState().commitPixels(cur, data);
        } else {
          const id = newLayerId();
          useProject.getState().addLayer({
            id,
            name: asset.name,
            type: asset.type,
            src: asset.src,
            naturalW: asset.naturalW,
            naturalH: asset.naturalH,
            visible: true,
            opacity: 1,
            keyframes: [
              {
                frame: cur,
                x: DOC_W / 2,
                y: DOC_H / 2,
                scale: containScale(asset.naturalW, asset.naturalH),
                rotation: 0,
                opacity: 1,
                easing: "linear",
              },
            ],
          });
          lastLayerId = id;
        }
        ok++;
      } catch (e) {
        pushToast("err", `${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBusy(false);
    if (ok > 0) {
      if (mode === "layer") {
        set({ selectedLayerId: lastLayerId, tool: "move" });
        pushToast("ok", `Imported ${ok} layer${ok > 1 ? "s" : ""} — drag to place, V to transform`);
      } else {
        pushToast("ok", `Rasterized ${ok} file${ok > 1 ? "s" : ""} into frame ${cur + 1}`);
      }
    }
    close();
  };

  return (
    <div className="modalScrim" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h2>Import</h2>
          <button className="iconBtn" onClick={close} title="Close (Esc)">
            <IconClose />
          </button>
        </div>

        <div className="importFiles">
          {files.length > 0 ? (
            files.map((f, i) => (
              <div key={i} className="importFile">
                {f.name || "(pasted image)"} <em>{(f.size / 1024).toFixed(1)} KB</em>
              </div>
            ))
          ) : (
            <div className="importHint">PNG · JPG · WebP · SVG — or drag &amp; drop / Ctrl+V anytime</div>
          )}
        </div>

        <div className="segmented importMode">
          <button className={mode === "layer" ? "active" : ""} onClick={() => setMode("layer")}>
            As animatable layer
          </button>
          <button className={mode === "pixels" ? "active" : ""} onClick={() => setMode("pixels")}>
            Into frame pixels
          </button>
        </div>

        {mode === "layer" ? (
          <p className="modalNote">
            Arrives centered, contain-fit. Move / scale / rotate with the <b>V</b> tool and keyframe it
            on the timeline. SVGs stay crisp at any scale (transform &amp; animate only — node editing
            is not supported yet).
          </p>
        ) : (
          <div className="importPixelOpts">
            <div className="row">
              <span className="miniLabel">Fit</span>
              {(["contain", "cover", "stretch", "1:1"] as FitMode[]).map((f) => (
                <button
                  key={f}
                  className={`chipBtn${fit === f ? " active" : ""}`}
                  onClick={() => setFit(f)}
                >
                  {f}
                </button>
              ))}
            </div>
            <label className="checkRow" title="Off = nearest-neighbor, best for pixel art">
              <input
                type="checkbox"
                checked={smoothing}
                onChange={(e) => setSmoothing(e.target.checked)}
              />
              Smoothing (off = nearest, for pixel art)
            </label>
          </div>
        )}

        <div className="modalActions">
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btnPrimary" disabled={busy} onClick={() => doImport(files)}>
            {busy ? "Importing…" : files.length > 0 ? "Import" : "Choose files…"}
          </button>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            if (list.length) void doImport(list);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
