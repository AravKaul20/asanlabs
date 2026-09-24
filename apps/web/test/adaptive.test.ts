import { describe, expect, it } from "vitest";
import { AdaptiveController } from "../lib/adaptive.ts";

/** Feed frames of a given processing cost for a duration, at that cost's cadence. */
function run(c: AdaptiveController, frameMs: number, durationMs: number, startAt = 0): number {
  let t = startAt;
  const end = startAt + durationMs;
  while (t <= end) {
    c.record(frameMs, t);
    t += frameMs;
  }
  return t;
}

describe("AdaptiveController", () => {
  it("starts on the Full model, every frame", () => {
    const c = new AdaptiveController();
    expect(c.state).toEqual({ variant: "full", frameStride: 1, slowDevice: false });
  });

  it("stays on Full while the device keeps up", () => {
    const c = new AdaptiveController();
    run(c, 40, 10000);
    expect(c.state.variant).toBe("full");
  });

  it("does not step down before the sustain window has passed", () => {
    const c = new AdaptiveController();
    run(c, 90, 2000);
    expect(c.state.variant).toBe("full");
  });

  it("steps down to Lite after 3 s of missing the target", () => {
    const c = new AdaptiveController();
    run(c, 90, 3500);
    expect(c.state.variant).toBe("lite");
    expect(c.state.frameStride).toBe(1);
  });

  it("then halves the frame rate if Lite is still too slow", () => {
    const c = new AdaptiveController();
    const t = run(c, 90, 3500);
    run(c, 90, 3500, t);
    expect(c.state).toMatchObject({ variant: "lite", frameStride: 2 });
  });

  it("reports a level change so the caller can rebuild the landmarker", () => {
    const c = new AdaptiveController();
    let changed = false;
    let t = 0;
    while (t <= 3500) {
      if (c.record(90, t)) changed = true;
      t += 90;
    }
    expect(changed).toBe(true);
  });

  it("does not report a change on an ordinary frame", () => {
    const c = new AdaptiveController();
    expect(c.record(40, 0)).toBe(false);
  });

  it("stops at the bottom of the ladder", () => {
    const c = new AdaptiveController();
    run(c, 200, 30000);
    expect(c.state.frameStride).toBe(2);
    expect(c.state.variant).toBe("lite");
  });

  it("raises the slow-device notice only at the bottom of the ladder", () => {
    const c = new AdaptiveController();
    run(c, 200, 3500);
    // Stepped down once, but should not be crying slow device yet.
    expect(c.state.slowDevice).toBe(false);
    run(c, 200, 30000);
    expect(c.state.slowDevice).toBe(true);
  });

  it("does not raise the notice for a device that is merely under 15 fps", () => {
    const c = new AdaptiveController();
    run(c, 80, 30000);
    expect(c.state.slowDevice).toBe(false);
  });

  it("resets its window after stepping down, giving the new level a fair trial", () => {
    const c = new AdaptiveController();
    const t = run(c, 90, 3500);
    expect(c.state.variant).toBe("lite");
    // Immediately fast again: it must not cascade to the next level.
    run(c, 30, 2000, t);
    expect(c.state.frameStride).toBe(1);
  });

  it("never steps back up once it has stepped down", () => {
    const c = new AdaptiveController();
    const t = run(c, 90, 3500);
    run(c, 20, 20000, t);
    expect(c.state.variant).toBe("lite");
  });

  it("reports a rolling average frame time", () => {
    const c = new AdaptiveController();
    run(c, 50, 900);
    expect(c.avgFrameMs).toBeCloseTo(50, 6);
  });

  it("reports fps from the gaps between processed frames", () => {
    const c = new AdaptiveController();
    run(c, 50, 900);
    expect(c.fps).toBeCloseTo(20, 1);
  });

  it("reports zero fps before any frame has been timed", () => {
    const c = new AdaptiveController();
    expect(c.fps).toBe(0);
    expect(c.avgFrameMs).toBe(0);
  });

  it("forgets old samples outside the rolling window", () => {
    const c = new AdaptiveController();
    c.record(500, 0);
    run(c, 30, 900, 2000);
    expect(c.avgFrameMs).toBeCloseTo(30, 6);
  });

  it("honours custom thresholds", () => {
    const c = new AdaptiveController({ targetFrameMs: 20, sustainMs: 500 });
    run(c, 30, 700);
    expect(c.state.variant).toBe("lite");
  });

  it("starts over on reset", () => {
    const c = new AdaptiveController();
    run(c, 200, 30000);
    c.reset();
    expect(c.state).toEqual({ variant: "full", frameStride: 1, slowDevice: false });
  });
});
