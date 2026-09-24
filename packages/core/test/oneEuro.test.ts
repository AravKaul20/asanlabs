import { describe, expect, it } from "vitest";
import { DEFAULT_COORD_CONFIG, FrameSmoother, OneEuroFilter } from "../src/oneEuro.ts";
import { LANDMARK_COUNT } from "../src/landmarks.ts";
import type { Frame } from "../src/types.ts";

describe("OneEuroFilter", () => {
  it("passes the first sample through untouched", () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0 });
    expect(f.filter(42, 0)).toBe(42);
  });

  it("matches the One Euro algorithm exactly for a known step", () => {
    // minCutoff=1 Hz, beta=0, dt=1 s => tau = 1/(2*pi), alpha = 1/(1+tau) = 0.8627...
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 });
    f.filter(0, 0);
    expect(f.filter(1, 1000)).toBeCloseTo(0.8627, 4);
  });

  it("holds steady on a constant signal", () => {
    const f = new OneEuroFilter({ minCutoff: 1.5, beta: 0.05 });
    let out = f.filter(5, 0);
    for (let t = 66; t <= 2000; t += 66) out = f.filter(5, t);
    expect(out).toBeCloseTo(5, 9);
  });

  it("lags a step instead of jumping to it", () => {
    const f = new OneEuroFilter({ minCutoff: 1.5, beta: 0.05 });
    f.filter(0, 0);
    const out = f.filter(10, 66);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(10);
  });

  it("converges to the new level after a step", () => {
    const f = new OneEuroFilter({ minCutoff: 1.5, beta: 0.05 });
    f.filter(0, 0);
    let out = 0;
    for (let t = 66; t <= 4000; t += 66) out = f.filter(10, t);
    expect(out).toBeCloseTo(10, 3);
  });

  it("removes jitter at realistic landmark amplitudes", () => {
    // Real MediaPipe jitter during a hold is millimetres, not metres. At that
    // amplitude beta barely opens the cutoff, so the filter should cut hard.
    const f = new OneEuroFilter(DEFAULT_COORD_CONFIG);
    const jitter = 0.005;
    const outputs: number[] = [];
    for (let i = 0; i < 60; i++) {
      outputs.push(f.filter(i % 2 === 0 ? jitter : -jitter, i * 66));
    }
    const tail = outputs.slice(20);
    const spread = Math.max(...tail) - Math.min(...tail);
    // For frame-alternating noise the steady-state output spread settles at
    // 2A*a/(2-a) where a is the smoothing factor: ~4.2x attenuation at 15 fps.
    // That is the worst case; real jitter is not this cleanly adversarial.
    expect(spread).toBeLessThan((2 * jitter) / 4);
  });

  it("still lets a real correction through at speed", () => {
    // A deliberate 20 cm move over ~0.5 s must not be smoothed into nothing.
    const f = new OneEuroFilter(DEFAULT_COORD_CONFIG);
    f.filter(0, 0);
    let out = 0;
    for (let i = 1; i <= 8; i++) out = f.filter(0.025 * i, i * 66);
    expect(out).toBeGreaterThan(0.1);
  });

  it("tracks fast motion more closely with a higher beta", () => {
    const lazy = new OneEuroFilter({ minCutoff: 1.5, beta: 0 });
    const eager = new OneEuroFilter({ minCutoff: 1.5, beta: 2 });
    lazy.filter(0, 0);
    eager.filter(0, 0);
    let lazyOut = 0;
    let eagerOut = 0;
    // A fast ramp: beta raises the cutoff with speed, so `eager` should lag less.
    for (let i = 1; i <= 10; i++) {
      lazyOut = lazy.filter(i, i * 66);
      eagerOut = eager.filter(i, i * 66);
    }
    expect(eagerOut).toBeGreaterThan(lazyOut);
  });

  it("ignores a non-advancing timestamp rather than dividing by zero", () => {
    const f = new OneEuroFilter({ minCutoff: 1.5, beta: 0.05 });
    f.filter(0, 100);
    const repeated = f.filter(99, 100);
    expect(Number.isFinite(repeated)).toBe(true);
    expect(repeated).toBe(0);
  });

  it("ignores a backwards timestamp", () => {
    const f = new OneEuroFilter({ minCutoff: 1.5, beta: 0.05 });
    f.filter(3, 1000);
    expect(f.filter(99, 500)).toBe(3);
  });

  it("starts over after reset", () => {
    const f = new OneEuroFilter({ minCutoff: 1.5, beta: 0.05 });
    f.filter(0, 0);
    f.filter(0, 66);
    f.reset();
    expect(f.filter(7, 132)).toBe(7);
  });

  it("rejects a non-positive minCutoff", () => {
    expect(() => new OneEuroFilter({ minCutoff: 0, beta: 0 })).toThrow();
  });
});

function rawFrame(t: number, x: number): Frame {
  const image = Array.from({ length: LANDMARK_COUNT }, () => ({ x, y: x, z: x, visibility: 1 }));
  const world = Array.from({ length: LANDMARK_COUNT }, () => ({ x, y: x, z: x, visibility: 1 }));
  return { t, image, world, visibility: Array.from({ length: LANDMARK_COUNT }, () => 1) };
}

describe("FrameSmoother", () => {
  it("returns the first frame unchanged", () => {
    const s = new FrameSmoother();
    const out = s.smooth(rawFrame(0, 1));
    expect(out.world[0]?.x).toBe(1);
    expect(out.image[0]?.y).toBe(1);
  });

  it("smooths both world and image landmarks", () => {
    const s = new FrameSmoother();
    s.smooth(rawFrame(0, 0));
    const out = s.smooth(rawFrame(66, 10));
    expect(out.world[5]?.x).toBeGreaterThan(0);
    expect(out.world[5]?.x).toBeLessThan(10);
    expect(out.image[5]?.x).toBeGreaterThan(0);
    expect(out.image[5]?.x).toBeLessThan(10);
  });

  it("preserves the frame timestamp and landmark count", () => {
    const s = new FrameSmoother();
    const out = s.smooth(rawFrame(123, 1));
    expect(out.t).toBe(123);
    expect(out.world).toHaveLength(LANDMARK_COUNT);
    expect(out.image).toHaveLength(LANDMARK_COUNT);
    expect(out.visibility).toHaveLength(LANDMARK_COUNT);
  });

  it("keeps visibility in 0..1 while damping threshold chatter", () => {
    const s = new FrameSmoother();
    const a = rawFrame(0, 1);
    const b = rawFrame(66, 1);
    b.visibility[0] = 0;
    if (b.world[0]) b.world[0].visibility = 0;
    s.smooth(a);
    const out = s.smooth(b);
    const vis = out.visibility[0] ?? -1;
    expect(vis).toBeGreaterThan(0);
    expect(vis).toBeLessThanOrEqual(1);
  });

  it("does not mutate the input frame", () => {
    const s = new FrameSmoother();
    s.smooth(rawFrame(0, 0));
    const input = rawFrame(66, 10);
    s.smooth(input);
    expect(input.world[0]?.x).toBe(10);
  });

  it("starts over after reset", () => {
    const s = new FrameSmoother();
    s.smooth(rawFrame(0, 0));
    s.reset();
    expect(s.smooth(rawFrame(66, 9)).world[0]?.x).toBe(9);
  });
});
