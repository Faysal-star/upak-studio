"use client";

// Custom HSV color picker (canvas SV square + hue strip, zero deps), hex
// input, auto-tracked recent colors, and an editable 16-swatch palette.

import { useEffect, useRef, useState } from "react";
import { useUi } from "../store/ui";

const SV_W = 176;
const SV_H = 120;
const HUE_H = 12;

function hexToHsv(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [hue, max === 0 ? 0 : d / max, max];
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const p = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`;
}

export default function ColorPanel() {
  const color = useUi((s) => s.color);
  const recent = useUi((s) => s.recent);
  const palette = useUi((s) => s.palette);
  const useColor = useUi((s) => s.useColor);
  const setPaletteSlot = useUi((s) => s.setPaletteSlot);

  const svRef = useRef<HTMLCanvasElement>(null);
  const hueRef = useRef<HTMLCanvasElement>(null);
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(color));
  const emittedRef = useRef(color.toLowerCase());
  const [hexInput, setHexInput] = useState(color);

  // external color change (eyedropper, palette click) -> resync wheel
  useEffect(() => {
    const lc = color.toLowerCase();
    setHexInput(lc);
    if (lc !== emittedRef.current) {
      setHsv(hexToHsv(lc));
      emittedRef.current = lc;
    }
  }, [color]);

  const emit = (h: number, s: number, v: number) => {
    const hex = hsvToHex(h, s, v);
    emittedRef.current = hex;
    useColor(hex);
  };

  // draw SV square
  useEffect(() => {
    const cv = svRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = hsvToHex(hsv[0], 1, 1);
    ctx.fillRect(0, 0, SV_W, SV_H);
    const white = ctx.createLinearGradient(0, 0, SV_W, 0);
    white.addColorStop(0, "#fff");
    white.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, SV_W, SV_H);
    const black = ctx.createLinearGradient(0, 0, 0, SV_H);
    black.addColorStop(0, "rgba(0,0,0,0)");
    black.addColorStop(1, "#000");
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, SV_W, SV_H);
    // marker
    const mx = hsv[1] * SV_W;
    const my = (1 - hsv[2]) * SV_H;
    ctx.beginPath();
    ctx.arc(mx, my, 5, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, 6.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [hsv]);

  // draw hue strip
  useEffect(() => {
    const cv = hueRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, SV_W, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, hsvToHex(i * 60 === 360 ? 0 : i * 60, 1, 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SV_W, HUE_H);
    const mx = (hsv[0] / 360) * SV_W;
    ctx.fillStyle = "#fff";
    ctx.fillRect(mx - 1.5, 0, 3, HUE_H);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.strokeRect(mx - 2, 0.5, 4, HUE_H - 1);
  }, [hsv]);

  const dragSv = (e: React.PointerEvent) => {
    const rect = svRef.current!.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / SV_W));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / SV_H));
    setHsv(([h]) => {
      emit(h, s, v);
      return [h, s, v];
    });
  };
  const dragHue = (e: React.PointerEvent) => {
    const rect = hueRef.current!.getBoundingClientRect();
    const h = Math.max(0, Math.min(359.9, ((e.clientX - rect.left) / SV_W) * 360));
    setHsv(([, s, v]) => {
      emit(h, s, v);
      return [h, s, v];
    });
  };
  const pointerHandlers = (fn: (e: React.PointerEvent) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      (e.target as Element).setPointerCapture(e.pointerId);
      fn(e);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.buttons & 1) fn(e);
    },
  });

  const applyHex = (v: string) => {
    const m = v.trim().replace(/^#?/, "#").toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(m)) {
      useColor(m);
      setHsv(hexToHsv(m));
      emittedRef.current = m;
    } else setHexInput(color);
  };

  return (
    <div className="colorPanel">
      <canvas ref={svRef} width={SV_W} height={SV_H} className="svSquare" {...pointerHandlers(dragSv)} />
      <canvas ref={hueRef} width={SV_W} height={HUE_H} className="hueStrip" {...pointerHandlers(dragHue)} />
      <div className="hexRow">
        <span className="colorChip" style={{ background: color }} />
        <input
          type="text"
          value={hexInput}
          spellCheck={false}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={(e) => applyHex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyHex((e.target as HTMLInputElement).value);
          }}
        />
      </div>
      {recent.length > 0 && (
        <>
          <div className="miniLabel">Recent</div>
          <div className="swatchRow">
            {recent.map((c, i) => (
              <button
                key={`${c}${i}`}
                className="swatch"
                style={{ background: c }}
                title={c}
                onClick={() => useColor(c)}
              />
            ))}
          </div>
        </>
      )}
      <div className="miniLabel">Palette <span className="hint">dblclick = replace with current</span></div>
      <div className="paletteGrid">
        {palette.map((c, i) => (
          <button
            key={i}
            className={`swatch${color.toLowerCase() === c ? " active" : ""}`}
            style={{ background: c }}
            title={c}
            onClick={() => useColor(c)}
            onDoubleClick={() => setPaletteSlot(i, useUi.getState().color)}
          />
        ))}
      </div>
    </div>
  );
}
