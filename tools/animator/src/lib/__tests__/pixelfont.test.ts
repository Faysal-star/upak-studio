import { describe, expect, it } from "vitest";
import type { RGBA } from "../draw";
import {
  drawPixelText,
  GLYPH_ADVANCE,
  GLYPH_H,
  GLYPH_W,
  glyphRows,
  hasGlyphs,
  measurePixelText,
} from "../pixelfont";

const RED: RGBA = [255, 0, 0, 255];

function litPixels(buf: Uint8ClampedArray, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (buf[(y * w + x) * 4 + 3] > 0) out.push([x, y]);
  return out;
}

describe("pixelfont", () => {
  it("covers all of ASCII 32..126 with well-formed 5x7 glyphs", () => {
    for (let c = 32; c <= 126; c++) {
      const ch = String.fromCharCode(c);
      expect(hasGlyphs(ch), `missing glyph for ${JSON.stringify(ch)}`).toBe(true);
      const rows = glyphRows(ch);
      expect(rows.length).toBe(GLYPH_H);
      for (const row of rows) {
        expect(row.length).toBe(GLYPH_W);
        expect(/^[.#]{5}$/.test(row), `bad row ${JSON.stringify(row)} in ${ch}`).toBe(true);
      }
    }
    expect(hasGlyphs("héllo")).toBe(false); // non-ASCII falls back to '?'
    expect(glyphRows("é")).toEqual(glyphRows("?"));
  });

  it("every printable glyph except space has at least one lit pixel", () => {
    for (let c = 33; c <= 126; c++) {
      const rows = glyphRows(String.fromCharCode(c));
      expect(rows.some((r) => r.includes("#"))).toBe(true);
    }
    expect(glyphRows(" ").every((r) => r === ".....")).toBe(true);
  });

  it("measures single-line text", () => {
    expect(measurePixelText("", 1)).toEqual({ w: 0, h: 0 });
    expect(measurePixelText("A", 1)).toEqual({ w: 5, h: 7 });
    expect(measurePixelText("AB", 1)).toEqual({ w: 11, h: 7 });
    expect(measurePixelText("AB", 2)).toEqual({ w: 22, h: 14 });
    expect(measurePixelText("ABC", 3)).toEqual({ w: (3 * GLYPH_ADVANCE - 1) * 3, h: 21 });
  });

  it("renders 'I' exactly as its glyph grid at x1", () => {
    const { w, h } = measurePixelText("I", 1);
    const buf = new Uint8ClampedArray(w * h * 4);
    drawPixelText(buf, w, h, 0, 0, "I", 1, RED);
    const rows = glyphRows("I");
    for (let y = 0; y < GLYPH_H; y++) {
      for (let x = 0; x < GLYPH_W; x++) {
        const on = buf[(y * w + x) * 4 + 3] > 0;
        expect(on, `pixel ${x},${y}`).toBe(rows[y][x] === "#");
        if (on) {
          expect(buf[(y * w + x) * 4]).toBe(255);
          expect(buf[(y * w + x) * 4 + 1]).toBe(0);
        }
      }
    }
  });

  it("scales x2 into 2x2 blocks", () => {
    const { w, h } = measurePixelText("I", 2);
    const buf = new Uint8ClampedArray(w * h * 4);
    drawPixelText(buf, w, h, 0, 0, "I", 2, RED);
    const rows = glyphRows("I");
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const on = buf[(y * w + x) * 4 + 3] > 0;
        const gx = Math.floor(x / 2);
        const gy = Math.floor(y / 2);
        expect(on).toBe(gx < GLYPH_W && rows[gy][gx] === "#");
      }
    }
    expect(litPixels(buf, w, h).length).toBe(
      4 * rows.reduce((n, r) => n + r.split("").filter((c) => c === "#").length, 0)
    );
  });

  it("advances 6px per glyph and clips out-of-bounds pixels safely", () => {
    const w = 8;
    const h = 7;
    const buf = new Uint8ClampedArray(w * h * 4);
    // "II" at x=0: second glyph starts at x=6, partially clipped at x=8
    drawPixelText(buf, w, h, 0, 0, "II", 1, RED);
    const lit = litPixels(buf, w, h);
    expect(lit.some(([x]) => x >= 6)).toBe(true); // second glyph visible
    // negative origin must not throw or wrap
    drawPixelText(buf, w, h, -3, -3, "W", 1, RED);
    expect(() => drawPixelText(buf, w, h, 100, 100, "W", 1, RED)).not.toThrow();
  });
});
