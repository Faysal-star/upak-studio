import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32 } from "../crc32";
import { fnv1a32, fnv1a32Bytes } from "../fnv";
import { encodeDpak, spriteName, TYPE_ANIM, TYPE_SPRITE, FMT_RGB565, FMT_RGB565_A1 } from "../dpak";
import { decodeAnim, decodeSprite, decodeSpritePayload, readDpak } from "../dpakReader";
import { quantize, to565 } from "../rgb565";

const W = 240;
const H = 240;

function makeFrame(kind: "gradient" | "shapes" | "sparse"): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (kind === "gradient") {
        buf[o] = x;
        buf[o + 1] = y;
        buf[o + 2] = (x + y) & 0xff;
        buf[o + 3] = 255;
      } else if (kind === "shapes") {
        const inside = (x - 120) ** 2 + (y - 120) ** 2 < 80 ** 2;
        buf[o] = inside ? 230 : 20;
        buf[o + 1] = inside ? 57 : 20;
        buf[o + 2] = inside ? 70 : 40;
        buf[o + 3] = 255;
      } else {
        // sparse: mostly transparent with an opaque square -> RGB565_A1
        const inside = x >= 50 && x < 150 && y >= 60 && y < 90;
        buf[o] = 0;
        buf[o + 1] = 180;
        buf[o + 2] = 216;
        buf[o + 3] = inside ? 255 : 0;
      }
    }
  }
  return buf;
}

describe("dpak encoder", () => {
  const frames = [
    { rgba: makeFrame("gradient"), durationMs: 100 },
    { rgba: makeFrame("shapes"), durationMs: 250 },
    { rgba: makeFrame("sparse"), durationMs: 80 },
  ];
  const pack = encodeDpak({
    name: "demo",
    width: W,
    height: H,
    frames,
    packId: 0x0123456789abcdefn,
  });

  it("has a valid header and CRC", () => {
    const pak = readDpak(pack);
    expect(pak.version).toBe(1);
    expect(pak.crcOk).toBe(true);
    expect(pak.packId).toBe(0x0123456789abcdefn);
    expect(pak.tocCount).toBe(4); // 3 sprites + 1 anim
    // header fields, byte-exact per spec
    const dv = new DataView(pack.buffer);
    expect(dv.getUint32(0, true)).toBe(0x4b415044); // "DPAK"
    expect(dv.getUint32(12, true)).toBe(32); // tocOffset
    expect(dv.getUint32(16, true)).toBe(crc32(pack.subarray(32)));
  });

  it("emits a well-formed TOC with FNV-1a name hashes", () => {
    const pak = readDpak(pack);
    for (let i = 0; i < 3; i++) {
      const e = pak.toc[i];
      expect(e.assetId).toBe(i + 1);
      expect(e.type).toBe(TYPE_SPRITE);
      expect(e.nameHash).toBe(fnv1a32(spriteName("demo", i)));
      expect(e.offset).toBeGreaterThanOrEqual(32 + 32 * 4);
      expect(e.offset + e.length).toBeLessThanOrEqual(pack.length);
    }
    const anim = pak.toc[3];
    expect(anim.assetId).toBe(4);
    expect(anim.type).toBe(TYPE_ANIM);
    expect(anim.nameHash).toBe(fnv1a32("demo"));
  });

  it("round-trips all 3 frames pixel-exact through decode", () => {
    const pak = readDpak(pack);
    const kinds: ("gradient" | "shapes" | "sparse")[] = ["gradient", "shapes", "sparse"];
    kinds.forEach((kind, i) => {
      const sprite = decodeSprite(pak, pak.toc[i]);
      expect(sprite.width).toBe(W);
      expect(sprite.height).toBe(H);
      const q = quantize(makeFrame(kind), W, H, false);
      expect(sprite.format).toBe(kind === "sparse" ? FMT_RGB565_A1 : FMT_RGB565);
      for (let p = 0; p < W * H; p++) {
        if (sprite.color[p] !== q.color[p]) {
          throw new Error(`frame ${i} pixel ${p}: ${sprite.color[p]} != ${q.color[p]}`);
        }
      }
      if (kind === "sparse") {
        expect(sprite.alpha).not.toBeNull();
        expect(Array.from(sprite.alpha!)).toEqual(Array.from(q.alpha));
      }
    });
  });

  it("encodes the ANIM blob with per-frame durations", () => {
    const pak = readDpak(pack);
    const anim = decodeAnim(pak, pak.toc[3]);
    expect(anim.frameCount).toBe(3);
    expect(anim.loopMode).toBe(1);
    expect(anim.defaultFpsX10).toBe(0);
    expect(anim.frames.map((f) => f.spriteId)).toEqual([1, 2, 3]);
    expect(anim.frames.map((f) => f.durationMs)).toEqual([100, 250, 80]);
  });

  it("quantizes a known color correctly", () => {
    expect(to565(255, 255, 255)).toBe(0xffff);
    expect(to565(0, 0, 0)).toBe(0x0000);
    expect(to565(255, 0, 0)).toBe(0xf800);
    expect(to565(0, 255, 0)).toBe(0x07e0);
    expect(to565(0, 0, 255)).toBe(0x001f);
  });
});

describe("golden fixture (tools/dpak-cli)", () => {
  const fixtureDir = join(__dirname, "..", "..", "..", "..", "dpak-cli", "fixtures");
  const dpakPath = join(fixtureDir, "golden_v1.dpak");
  const jsonPath = join(fixtureDir, "golden_v1.json");

  interface GoldenAsset {
    assetId: number;
    type: number;
    nameHash: string;
    offset: number;
    length: number;
  }
  interface GoldenSprite {
    assetId: number;
    nameHash: string;
    rawSize: number;
    decodedFnv: string;
  }

  it.skipIf(!existsSync(dpakPath) || !existsSync(jsonPath))(
    "parses golden_v1.dpak and matches golden_v1.json",
    () => {
      const data = new Uint8Array(readFileSync(dpakPath));
      const meta = JSON.parse(readFileSync(jsonPath, "utf8")) as {
        size: number;
        crc32: string;
        packId: string;
        tocCount: number;
        assets: GoldenAsset[];
        sprites: Record<string, GoldenSprite>;
      };
      const pak = readDpak(data);
      expect(data.length).toBe(meta.size);
      expect(pak.crcOk).toBe(true);
      expect(pak.crcStored >>> 0).toBe(Number(BigInt(meta.crc32)));
      expect(pak.packId).toBe(BigInt(meta.packId));
      expect(pak.tocCount).toBe(meta.tocCount);

      meta.assets.forEach((e, i) => {
        const t = pak.toc[i];
        expect(t.assetId).toBe(e.assetId);
        expect(t.type).toBe(e.type);
        expect(t.nameHash >>> 0).toBe(Number(BigInt(e.nameHash)));
        expect(t.offset).toBe(e.offset);
        expect(t.length).toBe(e.length);
      });

      // sprite payloads: rawSize + FNV-1a of decompressed planes, and name hashes
      for (const [name, g] of Object.entries(meta.sprites)) {
        const entry = pak.toc.find((t) => t.assetId === g.assetId)!;
        expect(entry).toBeDefined();
        expect(entry.type).toBe(TYPE_SPRITE);
        expect(entry.nameHash).toBe(fnv1a32(name));
        expect(entry.nameHash >>> 0).toBe(Number(BigInt(g.nameHash)));
        const { header, raw } = decodeSpritePayload(pak, entry);
        expect(header.rawSize).toBe(g.rawSize);
        expect(raw.length).toBe(g.rawSize);
        expect(fnv1a32Bytes(raw) >>> 0).toBe(Number(BigInt(g.decodedFnv)));
      }
    }
  );
});
