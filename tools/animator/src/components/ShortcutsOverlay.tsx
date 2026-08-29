"use client";

import { useUi } from "../store/ui";
import { IconClose } from "./Icons";

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Tools",
    rows: [
      ["B", "Pencil"],
      ["E", "Eraser"],
      ["L", "Line"],
      ["R", "Rectangle"],
      ["O", "Ellipse"],
      ["G", "Fill"],
      ["I", "Eyedropper"],
      ["T", "Text"],
      ["V", "Move / Transform layer"],
      ["M", "Rect select"],
    ],
  },
  {
    title: "Drawing",
    rows: [
      ["[ / ]", "Brush size down / up"],
      ["Shift", "Constrain: 45° line, square, circle"],
      ["Ctrl+Z / Ctrl+Y", "Undo / Redo"],
    ],
  },
  {
    title: "Selection (M)",
    rows: [
      ["Ctrl+C / Ctrl+X", "Copy / Cut selection (floating too)"],
      ["Ctrl+V", "Paste at the copied position"],
      ["Arrows / Shift+Arrows", "Nudge pixels 1px / 8px"],
      ["Enter / click outside", "Place floating pixels"],
      ["Delete", "Clear selection"],
      ["Esc", "Cancel floating / deselect"],
    ],
  },
  {
    title: "Layers (V) & Text (T)",
    rows: [
      ["Drag / corners / knob", "Move / scale / rotate layer"],
      ["Arrows / Shift+Arrows", "Nudge layer 1px / 8px"],
      ["Shift while rotating", "Snap to 15°"],
      ["T then click", "Place text (stamp or as layer)"],
      ["Enter / Esc (in text box)", "Place / cancel text"],
    ],
  },
  {
    title: "Timeline & view",
    rows: [
      [", / .", "Previous / next frame"],
      ["Enter", "Play / pause"],
      ["Space + drag", "Pan the canvas"],
      ["?", "This overlay"],
    ],
  },
];

export default function ShortcutsOverlay() {
  const show = useUi((s) => s.showShortcuts);
  const set = useUi((s) => s.set);
  if (!show) return null;
  return (
    <div className="modalScrim" onClick={() => set({ showShortcuts: false })}>
      <div className="modal shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h2>Keyboard shortcuts</h2>
          <button className="iconBtn" onClick={() => set({ showShortcuts: false })}>
            <IconClose />
          </button>
        </div>
        <div className="shortcutCols">
          {GROUPS.map((g) => (
            <div key={g.title} className="shortcutGroup">
              <div className="miniLabel">{g.title}</div>
              {g.rows.map(([k, d]) => (
                <div key={k} className="shortcutRow">
                  <kbd>{k}</kbd>
                  <span>{d}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
