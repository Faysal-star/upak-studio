"use client";

import { useUi } from "../store/ui";
import ColorPanel from "./ColorPanel";

export const BRUSH_SIZES = [1, 2, 3, 4, 6, 8, 12, 16];
const ZOOMS = [1, 2, 3, 4, 6, 8];

export default function ToolOptions() {
  const ui = useUi();
  const shapeTool = ui.tool === "rect" || ui.tool === "ellipse";
  const brushTool = ["pencil", "eraser", "line", "rect", "ellipse"].includes(ui.tool);

  return (
    <aside className="toolOptions">
      <div className="group">
        <div className="label">Brush</div>
        <div className="row">
          {BRUSH_SIZES.map((b) => (
            <button
              key={b}
              className={`chipBtn${ui.brush === b ? " active" : ""}`}
              disabled={!brushTool || (shapeTool && ui.shapeFill)}
              title={`${b}px ( [ and ] to adjust )`}
              onClick={() => ui.set({ brush: b })}
            >
              {b}
            </button>
          ))}
        </div>
        {shapeTool && (
          <div className="segmented">
            <button
              className={!ui.shapeFill ? "active" : ""}
              onClick={() => ui.set({ shapeFill: false })}
            >
              Outline
            </button>
            <button
              className={ui.shapeFill ? "active" : ""}
              onClick={() => ui.set({ shapeFill: true })}
            >
              Filled
            </button>
          </div>
        )}
        {ui.tool === "move" && (
          <label className="checkRow" title="Write a keyframe on every transform change">
            <input
              type="checkbox"
              checked={ui.autoKey}
              onChange={(e) => ui.set({ autoKey: e.target.checked })}
            />
            Auto-key transforms
          </label>
        )}
      </div>

      <div className="group">
        <div className="label">Color</div>
        <ColorPanel />
      </div>

      <div className="group">
        <div className="label">Zoom</div>
        <div className="row">
          {ZOOMS.map((z) => (
            <button
              key={z}
              className={`chipBtn${ui.zoom === z ? " active" : ""}`}
              onClick={() => ui.set({ zoom: z })}
            >
              {z}x
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
