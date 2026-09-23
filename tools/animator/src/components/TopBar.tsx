"use client";

import Link from "next/link";
import { blankFrame, redo, undo, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { IconChip, IconHelp, IconImport } from "./Icons";

export default function TopBar({ onSend }: { onSend: () => void }) {
  const animName = useUi((s) => s.animName);
  const set = useUi((s) => s.set);

  return (
    <header className="topbar">
      <div className="wordmark">
        <span className="logoDot" />
        uPack <em>Studio</em>
      </div>

      <input
        className="projectName"
        type="text"
        value={animName}
        spellCheck={false}
        title="Animation name (used for exported asset names)"
        onChange={(e) => set({ animName: e.target.value })}
      />

      <div className="topbarSpacer" />

      <button
        className="btn"
        title="Import image or SVG (or drag & drop / Ctrl+V)"
        onClick={() => set({ showImport: true, importFiles: [] })}
      >
        <IconImport /> Import
      </button>
      <button className="btn" onClick={undo} title="Undo (Ctrl+Z)">
        Undo
      </button>
      <button className="btn" onClick={redo} title="Redo (Ctrl+Y)">
        Redo
      </button>
      <button
        className="btn"
        title="Clear the whole project"
        onClick={() => {
          if (confirm("Clear the whole project? This cannot be undone.")) {
            useProject.getState().loadProject([blankFrame()], [], 0);
            set({ selectedLayerId: null });
          }
        }}
      >
        New
      </button>

      <div className="topbarDivider" />

      <button className="btn btnPrimary" onClick={onSend} title="Upload the animation over USB serial">
        <IconChip /> Send to device
      </button>

      <Link className="btn btnGhost" href="/flash" title="ESP32 firmware flash tool">
        Flash tool
      </Link>
      <button
        className="btn btnGhost btnIcon"
        title="Keyboard shortcuts (?)"
        onClick={() => set({ showShortcuts: true })}
      >
        <IconHelp />
      </button>
    </header>
  );
}
