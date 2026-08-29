import { describe, expect, it } from "vitest";
import { parseProject, serializeProject } from "../persist";
import type { OverlayLayer } from "../layers";

function b64(bytes: number[]): string {
  return Buffer.from(bytes).toString("base64");
}

describe("persist migration", () => {
  it("migrates a v0.1 document (no layers) to layers: []", () => {
    const v1 = JSON.stringify({
      v: 1,
      current: 1,
      animName: "blink",
      frames: [
        { id: "a", durationMs: 100, data: b64([1, 2, 3, 255]) },
        { id: "b", durationMs: 250, data: b64([9, 8, 7, 255]) },
      ],
    });
    const p = parseProject(v1);
    expect(p).not.toBeNull();
    expect(p!.layers).toEqual([]);
    expect(p!.frames).toHaveLength(2);
    expect(p!.frames[0].durationMs).toBe(100);
    expect(Array.from(p!.frames[1].data)).toEqual([9, 8, 7, 255]);
    expect(p!.current).toBe(1);
    expect(p!.animName).toBe("blink");
  });

  it("round-trips a v2 document with layers", () => {
    const layer: OverlayLayer = {
      id: "l1",
      name: "logo",
      type: "svg",
      src: "data:image/svg+xml;base64,PHN2Zy8+",
      naturalW: 100,
      naturalH: 50,
      visible: true,
      opacity: 0.8,
      keyframes: [
        { frame: 0, x: 10, y: 20, scale: 1, rotation: 0, opacity: 1, easing: "linear" },
        { frame: 3, x: 200, y: 20, scale: 2, rotation: 90, opacity: 0.5, easing: "easeInQuad" },
      ],
    };
    const json = serializeProject({
      frames: [{ id: "f1", durationMs: 80, data: new Uint8ClampedArray([0, 0, 0, 0]) }],
      layers: [layer],
      current: 0,
      animName: "demo",
    });
    const p = parseProject(json);
    expect(p).not.toBeNull();
    expect(p!.layers).toHaveLength(1);
    expect(p!.layers[0]).toEqual(layer);
  });

  it("never crashes on garbage or unknown versions", () => {
    expect(parseProject("not json {{{")).toBeNull();
    expect(parseProject(JSON.stringify({ v: 99, frames: [] }))).toBeNull();
    expect(parseProject(JSON.stringify({ v: 2, frames: [] }))).toBeNull();
    expect(parseProject(JSON.stringify({}))).toBeNull();
  });

  it("sanitizes malformed layer entries instead of failing", () => {
    const json = JSON.stringify({
      v: 2,
      current: 0,
      animName: "x",
      frames: [{ id: "f", durationMs: 100, data: b64([0, 0, 0, 0]) }],
      layers: [
        { nope: true }, // no src -> dropped
        {
          src: "data:image/png;base64,AA==",
          keyframes: [{ frame: "2", easing: "bogus", opacity: 7 }],
        },
      ],
    });
    const p = parseProject(json);
    expect(p).not.toBeNull();
    expect(p!.layers).toHaveLength(1);
    const l = p!.layers[0];
    expect(l.type).toBe("image");
    expect(l.visible).toBe(true);
    expect(l.keyframes[0].frame).toBe(2);
    expect(l.keyframes[0].easing).toBe("linear");
    expect(l.keyframes[0].opacity).toBe(1);
  });
});
