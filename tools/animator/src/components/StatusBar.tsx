"use client";

import { useProject } from "../store/project";
import { useUi } from "../store/ui";

export default function StatusBar() {
  const cursor = useUi((s) => s.cursor);
  const zoom = useUi((s) => s.zoom);
  const tool = useUi((s) => s.tool);
  const current = useProject((s) => Math.min(s.current, s.frames.length - 1));
  const total = useProject((s) => s.frames.length);
  const layerCount = useProject((s) => s.layers.length);

  return (
    <footer className="statusbar">
      <span className="statusCell statusTool">{tool}</span>
      <span className="statusCell">{cursor ? `${cursor.x}, ${cursor.y}` : "—"}</span>
      <span className="statusCell">{zoom}x</span>
      <span className="statusCell">
        frame {current + 1}/{total}
      </span>
      {layerCount > 0 && <span className="statusCell">{layerCount} layer{layerCount > 1 ? "s" : ""}</span>}
      <span className="statusSpacer" />
      <span className="statusCell dim">240×240 · RGB565</span>
    </footer>
  );
}
