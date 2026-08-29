"use client";

import { create } from "zustand";
import { compositeFrameCached, ensureBitmaps } from "../lib/bitmaps";
import { encodeDpak } from "../lib/dpak";
import { downloadBlob, toCHeader } from "../lib/exporters";
import { requestSerialPort, uploadDpak, webSerialSupported } from "../lib/serial";
import { useProject } from "../store/project";
import { useUi } from "../store/ui";
import { IconChevron, IconExport } from "./Icons";
import { useState } from "react";

// Flatten every frame through the SAME composite path as the editor preview,
// then feed the existing quantize+encode pipeline (byte format unchanged).
async function buildPack(name: string, dither: boolean): Promise<Uint8Array> {
  const { frames, layers } = useProject.getState();
  await ensureBitmaps(layers);
  return encodeDpak({
    name: name || "demo",
    width: 240,
    height: 240,
    frames: frames.map((f, i) => ({
      rgba: compositeFrameCached(f, layers, i),
      durationMs: f.durationMs,
    })),
    dither,
  });
}

interface SendState {
  busy: boolean;
  progress: number | null;
  log: string[];
}
const useSend = create<SendState>(() => ({ busy: false, progress: null, log: [] }));

// Shared by the panel button and the top-bar "Send to device" action.
export async function triggerSend(): Promise<void> {
  const ui = useUi.getState();
  if (useSend.getState().busy) return;
  if (!webSerialSupported()) {
    ui.pushToast("err", "Web Serial not available — use Chrome or Edge.");
    return;
  }
  useSend.setState({ busy: true, progress: 0, log: [] });
  try {
    const name = ui.animName.trim() || "demo";
    const pack = await buildPack(name, ui.dither);
    const port = await requestSerialPort();
    await uploadDpak(port, pack, {
      onProgress: (sent, total) => useSend.setState({ progress: sent / total }),
      onLog: (line) => useSend.setState((s) => ({ log: [...s.log, line] })),
    });
    ui.pushToast("ok", `Sent ${pack.length.toLocaleString()} bytes — device wrote /demo.dpak`);
  } catch (e) {
    ui.pushToast("err", e instanceof Error ? e.message : String(e));
  } finally {
    useSend.setState({ busy: false, progress: null });
  }
}

export default function ExportPanel() {
  const dither = useUi((s) => s.dither);
  const animName = useUi((s) => s.animName);
  const set = useUi((s) => s.set);
  const pushToast = useUi((s) => s.pushToast);
  const { busy, progress, log } = useSend();
  const [logOpen, setLogOpen] = useState(false);

  const name = animName.trim() || "demo";

  const exportDpak = async () => {
    const pack = await buildPack(name, dither);
    downloadBlob(`${name}.dpak`, pack, "application/octet-stream");
    pushToast("ok", `${name}.dpak — ${pack.length.toLocaleString()} bytes`);
  };

  const exportHeader = async () => {
    const pack = await buildPack(name, dither);
    downloadBlob(`${name}_dpak.h`, toCHeader(name, pack), "text/plain");
    pushToast("ok", `${name}_dpak.h — ${pack.length.toLocaleString()} bytes packed`);
  };

  return (
    <div className="exportPanel">
      <label className="checkRow" title="Floyd–Steinberg dithering during RGB565 quantization">
        <input type="checkbox" checked={dither} onChange={(e) => set({ dither: e.target.checked })} />
        Dither on export
      </label>
      <div className="row">
        <button className="btn" onClick={exportDpak} title="Download the binary DPAK pack">
          <IconExport /> .dpak
        </button>
        <button className="btn" onClick={exportHeader} title="Download as embeddable C header">
          <IconExport /> C header
        </button>
      </div>
      <button className="btn btnPrimary" disabled={busy} onClick={triggerSend}>
        {busy ? "Sending…" : "Send to device"}
      </button>
      {progress !== null && (
        <div className="progressOuter">
          <div className="progressInner" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      {log.length > 0 && (
        <div className="logWrap">
          <button className="logToggle" onClick={() => setLogOpen((v) => !v)}>
            <IconChevron open={logOpen} /> Serial log ({log.length})
          </button>
          {logOpen && <div className="log">{log.join("\n")}</div>}
        </div>
      )}
    </div>
  );
}
