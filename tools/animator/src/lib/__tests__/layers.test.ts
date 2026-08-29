import { describe, expect, it } from "vitest";
import {
  applyEasing,
  deleteKeyframe,
  sampleLayerTransform,
  shiftKeyframesForDelete,
  shiftKeyframesForInsert,
  upsertKeyframe,
  DEFAULT_TRANSFORM,
  type Keyframe,
} from "../layers";

const kf = (frame: number, p: Partial<Keyframe> = {}): Keyframe => ({
  frame,
  x: 120,
  y: 120,
  scale: 1,
  rotation: 0,
  opacity: 1,
  easing: "linear",
  ...p,
});

describe("sampleLayerTransform", () => {
  it("returns the default transform with no keyframes", () => {
    expect(sampleLayerTransform({ keyframes: [] }, 3)).toEqual(DEFAULT_TRANSFORM);
  });

  it("is constant with a single keyframe", () => {
    const kfs = [kf(4, { x: 50, y: 60, scale: 2, rotation: 45, opacity: 0.5 })];
    for (const f of [0, 4, 10]) {
      expect(sampleLayerTransform({ keyframes: kfs }, f)).toEqual({
        x: 50,
        y: 60,
        scale: 2,
        rotation: 45,
        opacity: 0.5,
      });
    }
  });

  it("holds the first keyframe before it and the last after it", () => {
    const kfs = [kf(2, { x: 10 }), kf(6, { x: 90 })];
    expect(sampleLayerTransform({ keyframes: kfs }, 0).x).toBe(10);
    expect(sampleLayerTransform({ keyframes: kfs }, 2).x).toBe(10);
    expect(sampleLayerTransform({ keyframes: kfs }, 6).x).toBe(90);
    expect(sampleLayerTransform({ keyframes: kfs }, 99).x).toBe(90);
  });

  it("interpolates linearly between keyframes", () => {
    const kfs = [
      kf(0, { x: 0, y: 100, scale: 1, rotation: 0, opacity: 0 }),
      kf(4, { x: 100, y: 200, scale: 3, rotation: 90, opacity: 1 }),
    ];
    const t = sampleLayerTransform({ keyframes: kfs }, 1);
    expect(t.x).toBeCloseTo(25);
    expect(t.y).toBeCloseTo(125);
    expect(t.scale).toBeCloseTo(1.5);
    expect(t.rotation).toBeCloseTo(22.5);
    expect(t.opacity).toBeCloseTo(0.25);
  });

  it("uses the LEFT keyframe's easing on each segment", () => {
    const kfs = [
      kf(0, { x: 0, easing: "easeInQuad" }),
      kf(10, { x: 100, easing: "easeOutQuad" }),
      kf(20, { x: 200 }),
    ];
    // segment 0..10 uses easeInQuad: t=0.5 -> 0.25
    expect(sampleLayerTransform({ keyframes: kfs }, 5).x).toBeCloseTo(25);
    // segment 10..20 uses easeOutQuad: t=0.5 -> 0.75
    expect(sampleLayerTransform({ keyframes: kfs }, 15).x).toBeCloseTo(175);
  });

  it("picks the correct segment among many keyframes", () => {
    const kfs = [kf(0, { x: 0 }), kf(2, { x: 20 }), kf(8, { x: 80 })];
    expect(sampleLayerTransform({ keyframes: kfs }, 2).x).toBe(20);
    expect(sampleLayerTransform({ keyframes: kfs }, 5).x).toBeCloseTo(50);
  });
});

describe("easing", () => {
  it("maps endpoints to 0 and 1", () => {
    for (const e of ["linear", "easeInQuad", "easeOutQuad", "easeInOutQuad"] as const) {
      expect(applyEasing(e, 0)).toBeCloseTo(0);
      expect(applyEasing(e, 1)).toBeCloseTo(1);
    }
    expect(applyEasing("easeInOutQuad", 0.5)).toBeCloseTo(0.5);
  });
});

describe("keyframe list ops", () => {
  it("upsert inserts sorted and replaces same-frame", () => {
    let kfs: Keyframe[] = [];
    kfs = upsertKeyframe(kfs, kf(5, { x: 1 }));
    kfs = upsertKeyframe(kfs, kf(1, { x: 2 }));
    kfs = upsertKeyframe(kfs, kf(5, { x: 3 }));
    expect(kfs.map((k) => k.frame)).toEqual([1, 5]);
    expect(kfs[1].x).toBe(3);
  });

  it("delete removes by frame", () => {
    const kfs = [kf(1), kf(5)];
    expect(deleteKeyframe(kfs, 5).map((k) => k.frame)).toEqual([1]);
  });

  it("shifts on insert and delete", () => {
    const kfs = [kf(0), kf(2), kf(4)];
    expect(shiftKeyframesForInsert(kfs, 2).map((k) => k.frame)).toEqual([0, 3, 5]);
    expect(shiftKeyframesForDelete(kfs, 2).map((k) => k.frame)).toEqual([0, 3]);
    expect(shiftKeyframesForDelete(kfs, 3).map((k) => k.frame)).toEqual([0, 2, 3]);
  });
});
