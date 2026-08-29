"use client";

// One-line contextual hint bar above the timeline: what the current tool does
// and its live keys. Cheap, always visible, keeps the workflow discoverable.

import { useSelection } from "../store/selection";
import { useUi } from "../store/ui";

const HINTS: Record<string, string> = {
  pencil: "drag = draw · Shift = straight segments · [ ] brush size · ,/. frames",
  eraser: "drag = erase · [ ] brush size",
  line: "drag = line · Shift = snap 45°",
  rect: "drag = rectangle · Shift = square",
  ellipse: "drag = ellipse · Shift = circle",
  fill: "click = flood fill",
  picker: "click = pick color from composite",
  text: "click canvas = place text · Enter place · Esc cancel",
};

export default function HintBar() {
  const tool = useUi((s) => s.tool);
  const selectedLayerId = useUi((s) => s.selectedLayerId);
  const rect = useSelection((s) => s.rect);
  const floating = useSelection((s) => s.floating);
  const clipboard = useSelection((s) => s.clipboard);

  let hint: string;
  if (tool === "select") {
    if (floating)
      hint =
        "drag / arrows = move (Shift = 8px) · Enter or click outside = place · Ctrl+C copy · Esc drop";
    else if (rect)
      hint =
        "drag inside = move pixels · arrows nudge (Shift = 8px) · Ctrl+C/X copy/cut · Del clear · ,/. frame then Ctrl+V pastes in place";
    else
      hint = `drag = select pixels${clipboard ? " · Ctrl+V = paste at copied position" : ""} · Esc deselect`;
  } else if (tool === "move") {
    hint = selectedLayerId
      ? "drag = move · corners = scale · knob = rotate (Shift snaps 15°) · arrows nudge (Shift = 8px) · Esc deselect"
      : "click a layer to select it · imported images/SVG and text layers are movable";
  } else {
    hint = HINTS[tool] ?? "";
  }

  return (
    <div className="hintBar">
      <span className="hintTool">{tool}</span>
      <span className="hintText">{hint}</span>
    </div>
  );
}
