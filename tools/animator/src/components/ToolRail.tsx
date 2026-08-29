"use client";

import type { ReactNode } from "react";
import { useUi, type Tool } from "../store/ui";
import {
  IconEllipse,
  IconEraser,
  IconFill,
  IconGrid,
  IconLine,
  IconMove,
  IconOnion,
  IconPencil,
  IconPicker,
  IconRect,
  IconSelect,
  IconText,
} from "./Icons";

const TOOLS: { id: Tool; label: string; key: string; icon: ReactNode }[] = [
  { id: "pencil", label: "Pencil", key: "B", icon: <IconPencil /> },
  { id: "eraser", label: "Eraser", key: "E", icon: <IconEraser /> },
  { id: "line", label: "Line", key: "L", icon: <IconLine /> },
  { id: "rect", label: "Rectangle", key: "R", icon: <IconRect /> },
  { id: "ellipse", label: "Ellipse", key: "O", icon: <IconEllipse /> },
  { id: "fill", label: "Fill", key: "G", icon: <IconFill /> },
  { id: "picker", label: "Eyedropper", key: "I", icon: <IconPicker /> },
  { id: "text", label: "Text", key: "T", icon: <IconText /> },
  { id: "move", label: "Move / Transform", key: "V", icon: <IconMove /> },
  { id: "select", label: "Rect select", key: "M", icon: <IconSelect /> },
];

export default function ToolRail() {
  const tool = useUi((s) => s.tool);
  const grid = useUi((s) => s.grid);
  const onion = useUi((s) => s.onion);
  const set = useUi((s) => s.set);

  return (
    <nav className="toolRail">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`railBtn${tool === t.id ? " active" : ""}`}
          data-tip={`${t.label} (${t.key})`}
          onClick={() => set({ tool: t.id })}
        >
          {t.icon}
        </button>
      ))}
      <div className="railDivider" />
      <button
        className={`railBtn${grid ? " active" : ""}`}
        data-tip="Pixel grid (at 4x+)"
        onClick={() => set({ grid: !grid })}
      >
        <IconGrid />
      </button>
      <button
        className={`railBtn${onion ? " active" : ""}`}
        data-tip="Onion skin (previous frame)"
        onClick={() => set({ onion: !onion })}
      >
        <IconOnion />
      </button>
    </nav>
  );
}
