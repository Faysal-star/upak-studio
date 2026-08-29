"use client";

import { useEffect, useRef, useState } from "react";
import { compositeFrameCached, subscribeBitmaps } from "../lib/bitmaps";
import { roundTrip565 } from "../lib/rgb565";
import { DOC_H, DOC_W, useProject } from "../store/project";

// Full composite (raster + tweened layers) round-tripped through RGB565 —
// exactly what the panel on the desk will show, in a little device mockup.
export default function DevicePreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const rtRef = useRef<Uint8ClampedArray | null>(null);
  const [, force] = useState(0);

  const frames = useProject((s) => s.frames);
  const layers = useProject((s) => s.layers);
  const current = useProject((s) => Math.min(s.current, s.frames.length - 1));

  useEffect(() => subscribeBitmaps(() => force((v) => v + 1)), []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const data = compositeFrameCached(frames[current], layers, current);
    if (!rtRef.current) rtRef.current = new Uint8ClampedArray(DOC_W * DOC_H * 4);
    roundTrip565(data, rtRef.current);
    if (!offRef.current) {
      offRef.current = document.createElement("canvas");
      offRef.current.width = DOC_W;
      offRef.current.height = DOC_H;
    }
    offRef.current
      .getContext("2d")!
      .putImageData(new ImageData(new Uint8ClampedArray(rtRef.current), DOC_W, DOC_H), 0, 0);
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offRef.current, 0, 0, DOC_W, DOC_H);
  });

  return (
    <div className="devicePreview">
      <div className="deviceShell">
        <div className="deviceSpeaker" />
        <div className="deviceScreen">
          <canvas ref={canvasRef} width={DOC_W} height={DOC_H} />
        </div>
        <div className="deviceChin">
          <span className="deviceLed" />
        </div>
      </div>
      <div className="previewLabel">live RGB565 · 240×240</div>
    </div>
  );
}
