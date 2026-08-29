"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { webSerialSupported } from "../lib/serial";

type Mode = "merged" | "parts";

interface Slot {
  label: string;
  defaultOffset: string;
  file: File | null;
  offset: string;
}

const PART_SLOTS: Omit<Slot, "file" | "offset">[] = [
  { label: "Bootloader", defaultOffset: "0x1000" },
  { label: "Partition table", defaultOffset: "0x8000" },
  { label: "Application", defaultOffset: "0x10000" },
];

async function fileToBinaryString(f: File): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return s;
}

export default function FlashTool() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>("merged");
  const [mergedFile, setMergedFile] = useState<File | null>(null);
  const [mergedOffset, setMergedOffset] = useState("0x0");
  const [slots, setSlots] = useState<Slot[]>(
    PART_SLOTS.map((s) => ({ ...s, file: null, offset: s.defaultOffset }))
  );
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSupported(webSerialSupported()), []);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  const appendLog = (line: string) =>
    setLog((l) => (l.length > 500 ? [...l.slice(-400), line] : [...l, line]));

  const flash = async () => {
    const files: { file: File; offset: number }[] = [];
    if (mode === "merged") {
      if (!mergedFile) return appendLog("Pick a merged .bin first.");
      files.push({ file: mergedFile, offset: parseInt(mergedOffset, 16) || 0 });
    } else {
      for (const s of slots) {
        if (s.file) files.push({ file: s.file, offset: parseInt(s.offset, 16) || 0 });
      }
      if (files.length === 0) return appendLog("Pick at least one .bin first.");
    }

    setBusy(true);
    setProgress(null);
    let transport: { disconnect(): Promise<void> } | null = null;
    try {
      appendLog("Requesting serial port…");
      const nav = navigator as unknown as { serial: { requestPort(): Promise<unknown> } };
      const port = await nav.serial.requestPort();

      const esptool = await import("esptool-js");
      const t = new (esptool.Transport as any)(port, true);
      transport = t;
      const terminal = {
        clean: () => {},
        writeLine: (data: string) => appendLog(data),
        write: (data: string) => appendLog(data),
      };
      const loader = new (esptool.ESPLoader as any)({
        transport: t,
        baudrate: 460800,
        romBaudrate: 115200,
        terminal,
      });

      appendLog("Connecting (hold BOOT if it does not sync)…");
      const chip = await loader.main();
      appendLog(`Connected: ${chip}`);

      const fileArray = [];
      for (const f of files) {
        appendLog(`Loading ${f.file.name} @ 0x${f.offset.toString(16)} (${f.file.size} bytes)`);
        fileArray.push({ data: await fileToBinaryString(f.file), address: f.offset });
      }

      await loader.writeFlash({
        fileArray,
        flashSize: "keep",
        flashMode: "keep",
        flashFreq: "keep",
        eraseAll: false,
        compress: true,
        reportProgress: (fileIndex: number, written: number, total: number) => {
          setProgress((fileIndex + written / total) / fileArray.length);
        },
      });
      appendLog("Flash complete. Resetting device…");
      await loader.after("hard_reset");
      appendLog("Done.");
    } catch (e) {
      appendLog(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      try {
        await transport?.disconnect();
      } catch {
        /* ignore */
      }
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="flashPage">
      <h1>DeskPet firmware flasher</h1>
      <p style={{ margin: 0, color: "var(--fg-dim)" }}>
        Flash ESP32 firmware .bin files over USB with Web Serial (esptool-js).{" "}
        <Link href="/">← back to animator</Link>
      </p>

      {supported === false && (
        <div className="notice">
          This browser does not support Web Serial. Use a Chromium browser (Chrome, Edge, Opera)
          on desktop.
        </div>
      )}

      <div className="card">
        <div className="row">
          <button className={mode === "merged" ? "active" : ""} onClick={() => setMode("merged")}>
            Single merged .bin
          </button>
          <button className={mode === "parts" ? "active" : ""} onClick={() => setMode("parts")}>
            Bootloader + partitions + app
          </button>
        </div>

        {mode === "merged" ? (
          <div className="fileRow">
            <span>Merged image</span>
            <input
              type="file"
              accept=".bin"
              onChange={(e) => setMergedFile(e.target.files?.[0] ?? null)}
            />
            <input
              type="text"
              value={mergedOffset}
              onChange={(e) => setMergedOffset(e.target.value)}
              title="Flash offset (hex)"
            />
          </div>
        ) : (
          slots.map((s, i) => (
            <div className="fileRow" key={s.label}>
              <span>{s.label}</span>
              <input
                type="file"
                accept=".bin"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setSlots((prev) => prev.map((p, j) => (j === i ? { ...p, file } : p)));
                }}
              />
              <input
                type="text"
                value={s.offset}
                title="Flash offset (hex)"
                onChange={(e) => {
                  const offset = e.target.value;
                  setSlots((prev) => prev.map((p, j) => (j === i ? { ...p, offset } : p)));
                }}
              />
            </div>
          ))
        )}

        <button disabled={busy || supported === false} onClick={flash}>
          {busy ? "Flashing…" : "Connect & flash"}
        </button>
        {progress !== null && (
          <div className="progressOuter">
            <div className="progressInner" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>

      <div className="card">
        <div className="label" style={{ fontSize: 10, textTransform: "uppercase", color: "var(--fg-dim)" }}>
          Log
        </div>
        <div className="log" ref={logRef} style={{ maxHeight: 260 }}>
          {log.join("\n") || "—"}
        </div>
      </div>
    </div>
  );
}
