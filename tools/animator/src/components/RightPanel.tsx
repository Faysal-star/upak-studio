"use client";

import { useState, type ReactNode } from "react";
import DevicePreview from "./DevicePreview";
import ExportPanel from "./ExportPanel";
import LayersPanel from "./LayersPanel";
import { IconChevron } from "./Icons";

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="panelSection">
      <button className="sectionHeader" onClick={() => setOpen((v) => !v)}>
        <IconChevron open={open} />
        {title}
      </button>
      {open && <div className="sectionBody">{children}</div>}
    </section>
  );
}

export default function RightPanel() {
  return (
    <aside className="side">
      <Section title="Preview">
        <DevicePreview />
      </Section>
      <Section title="Layers">
        <LayersPanel />
      </Section>
      <Section title="Export">
        <ExportPanel />
      </Section>
    </aside>
  );
}
