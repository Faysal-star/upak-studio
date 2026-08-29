import { describe, expect, it } from "vitest";
import { compressBlock, decompressBlock } from "../lz4";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

describe("lz4 block", () => {
  it("decodes a hand-crafted reference block", () => {
    // 1 literal 'a', match offset=1 len=7, empty trailing literals -> "aaaaaaaa"
    const block = new Uint8Array([0x13, 0x61, 0x01, 0x00, 0x00]);
    const out = decompressBlock(block, 8);
    expect(Array.from(out)).toEqual(new Array(8).fill(0x61));
  });

  it("round-trips buffers of many sizes", () => {
    const rand = rng(1234);
    for (const n of [0, 1, 4, 5, 11, 12, 13, 64, 100, 1000, 4096, 70000]) {
      const src = new Uint8Array(n);
      for (let i = 0; i < n; i++) src[i] = rand() & 0xff;
      const c = compressBlock(src);
      const d = decompressBlock(c, n);
      expect(d).toEqual(src);
    }
  });

  it("round-trips highly compressible data and shrinks it", () => {
    const src = new Uint8Array(50000);
    for (let i = 0; i < src.length; i++) src[i] = (i / 100) & 0xff;
    const c = compressBlock(src);
    expect(c.length).toBeLessThan(src.length / 2);
    expect(decompressBlock(c, src.length)).toEqual(src);
  });

  it("round-trips overlapping-match data (RLE-style runs)", () => {
    const src = new Uint8Array(10000).fill(7);
    src.set([1, 2, 3, 4, 5], 5000);
    const c = compressBlock(src);
    expect(decompressBlock(c, src.length)).toEqual(src);
  });

  it("round-trips mixed random/repetitive data", () => {
    const rand = rng(42);
    const src = new Uint8Array(120000);
    for (let i = 0; i < src.length; i++) {
      src[i] = i % 3 === 0 ? rand() & 0xff : (i >> 4) & 0xff;
    }
    const c = compressBlock(src);
    expect(decompressBlock(c, src.length)).toEqual(src);
  });
});
