import { describe, expect, it } from "vitest";
import { SettleGate } from "../src/settleGate.ts";
import { FeatureExtractor } from "../src/features/extractor.ts";
import { parsePose } from "../src/pose/schema.ts";
import { buildFrame, MOUNTAIN, withJoints } from "./fixtures/skeleton.ts";
import type { Frame } from "../src/types.ts";
import { clone } from "./support/clone.ts";

const extractor = new FeatureExtractor();

const pose = parsePose({
  id: "m",
  name: "M",
  version: 1,
  view: "front",
  sides: ["left"],
  requiredLandmarks: [
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
  ],
  settleShape: [{ feature: "torso_tilt", range: [0, 15] }],
  rules: [
    {
      id: "r",
      priority: "alignment",
      feature: "torso_tilt",
      range: [0, 8],
      hysteresis: 2,
      cues: { tooHigh: ["Stand tall."] },
      highlight: ["left_hip"],
      weight: 1,
      source: "self",
    },
  ],
});

const noShape = parsePose({ ...clone(pose), settleShape: [] });

/** Feed a gate a run of identical still frames, 66 ms apart, and return the last state. */
function holdStill(
  gate: SettleGate,
  durationMs: number,
  frameOf: (t: number) => Frame = (t) => buildFrame(t, MOUNTAIN),
) {
  let state = gate.update(frameOf(0), extractor.extract(frameOf(0), "left"), pose, "left");
  for (let t = 66; t <= durationMs; t += 66) {
    const frame = frameOf(t);
    state = gate.update(frame, extractor.extract(frame, "left"), pose, "left");
  }
  return state;
}

describe("SettleGate stillness", () => {
  it("is not settled on the first frame", () => {
    const gate = new SettleGate();
    const frame = buildFrame(0, MOUNTAIN);
    const state = gate.update(frame, extractor.extract(frame, "left"), pose, "left");
    expect(state.settled).toBe(false);
  });

  it("is not settled before a full second of stillness", () => {
    expect(holdStill(new SettleGate(), 800).settled).toBe(false);
  });

  it("settles once still for a second with the shape held", () => {
    const state = holdStill(new SettleGate(), 1200);
    expect(state.settled).toBe(true);
    expect(state.shapeOk).toBe(true);
    expect(state.stillForMs).toBeGreaterThanOrEqual(1000);
  });

  it("reports mean landmark velocity near zero while still", () => {
    expect(holdStill(new SettleGate(), 1200).meanVelocity).toBeCloseTo(0, 6);
  });

  it("reports a real velocity while the body moves", () => {
    const gate = new SettleGate();
    // Drift 2 cm per 66 ms frame => about 0.3 m/s.
    const state = holdStill(gate, 1200, (t) =>
      buildFrame(t, MOUNTAIN, { offset: { x: 0.02 * (t / 66), y: 0, z: 0 } }),
    );
    expect(state.meanVelocity).toBeCloseTo(0.303, 2);
    expect(state.settled).toBe(false);
  });

  it("restarts the stillness timer when the body moves again", () => {
    const gate = new SettleGate();
    holdStill(gate, 1200);
    // One large jump, then check the gate has dropped out of settled.
    const moved = buildFrame(1266, MOUNTAIN, { offset: { x: 0.3, y: 0, z: 0 } });
    const state = gate.update(moved, extractor.extract(moved, "left"), pose, "left");
    expect(state.settled).toBe(false);
    expect(state.stillForMs).toBe(0);
  });

  it("needs another full second after moving before settling again", () => {
    const gate = new SettleGate();
    holdStill(gate, 1200);
    const moved = buildFrame(1266, MOUNTAIN, { offset: { x: 0.3, y: 0, z: 0 } });
    gate.update(moved, extractor.extract(moved, "left"), pose, "left");
    const shifted = { ...MOUNTAIN };
    let state = gate.update(
      buildFrame(1332, shifted, { offset: { x: 0.3, y: 0, z: 0 } }),
      extractor.extract(buildFrame(1332, shifted, { offset: { x: 0.3, y: 0, z: 0 } }), "left"),
      pose,
      "left",
    );
    expect(state.settled).toBe(false);
    for (let t = 1398; t <= 2600; t += 66) {
      const f = buildFrame(t, shifted, { offset: { x: 0.3, y: 0, z: 0 } });
      state = gate.update(f, extractor.extract(f, "left"), pose, "left");
    }
    expect(state.settled).toBe(true);
  });
});

describe("SettleGate shape check", () => {
  it("does not settle while the settleShape range fails", () => {
    const leaning = withJoints(MOUNTAIN, {
      left_shoulder: { x: 0.1, y: -0.45, z: 0 },
      right_shoulder: { x: 0.46, y: -0.45, z: 0 },
    });
    const gate = new SettleGate();
    let state = gate.update(
      buildFrame(0, leaning),
      extractor.extract(buildFrame(0, leaning), "left"),
      pose,
      "left",
    );
    for (let t = 66; t <= 2000; t += 66) {
      const f = buildFrame(t, leaning);
      state = gate.update(f, extractor.extract(f, "left"), pose, "left");
    }
    expect(state.shapeOk).toBe(false);
    expect(state.settled).toBe(false);
  });

  it("settles as soon as the shape comes good, if already still", () => {
    const leaning = withJoints(MOUNTAIN, {
      left_shoulder: { x: 0.1, y: -0.45, z: 0 },
      right_shoulder: { x: 0.46, y: -0.45, z: 0 },
    });
    const gate = new SettleGate();
    // Still but out of shape for over a second...
    for (let t = 0; t <= 1500; t += 66) {
      const f = buildFrame(t, leaning);
      gate.update(f, extractor.extract(f, "left"), pose, "left");
    }
    // ...then the shoulders level out without the body lurching.
    const fixed = buildFrame(1566, MOUNTAIN);
    const state = gate.update(fixed, extractor.extract(fixed, "left"), pose, "left");
    expect(state.shapeOk).toBe(true);
  });

  it("treats an empty settleShape as always in shape", () => {
    const gate = new SettleGate();
    let state = gate.update(
      buildFrame(0, MOUNTAIN),
      extractor.extract(buildFrame(0, MOUNTAIN), "left"),
      noShape,
      "left",
    );
    for (let t = 66; t <= 1200; t += 66) {
      const f = buildFrame(t, MOUNTAIN);
      state = gate.update(f, extractor.extract(f, "left"), noShape, "left");
    }
    expect(state.shapeOk).toBe(true);
    expect(state.settled).toBe(true);
  });

  it("is not in shape when the settleShape feature is not visible enough", () => {
    const gate = new SettleGate();
    const opts = { visibility: { left_shoulder: 0.1 } } as const;
    let state = gate.update(
      buildFrame(0, MOUNTAIN, opts),
      extractor.extract(buildFrame(0, MOUNTAIN, opts), "left"),
      pose,
      "left",
    );
    for (let t = 66; t <= 1400; t += 66) {
      const f = buildFrame(t, MOUNTAIN, opts);
      state = gate.update(f, extractor.extract(f, "left"), pose, "left");
    }
    expect(state.shapeOk).toBe(false);
    expect(state.settled).toBe(false);
  });
});

describe("SettleGate tracking loss", () => {
  it("will not settle while a required landmark is not visible", () => {
    const gate = new SettleGate();
    const opts = { visibility: { left_ankle: 0.2 } } as const;
    let state = gate.update(
      buildFrame(0, MOUNTAIN, opts),
      extractor.extract(buildFrame(0, MOUNTAIN, opts), "left"),
      noShape,
      "left",
    );
    for (let t = 66; t <= 2000; t += 66) {
      const f = buildFrame(t, MOUNTAIN, opts);
      state = gate.update(f, extractor.extract(f, "left"), noShape, "left");
    }
    expect(state.settled).toBe(false);
  });
});

describe("SettleGate configuration and reset", () => {
  it("honours a custom still duration", () => {
    const gate = new SettleGate({ stillDurationMs: 300 });
    let state = gate.update(
      buildFrame(0, MOUNTAIN),
      extractor.extract(buildFrame(0, MOUNTAIN), "left"),
      pose,
      "left",
    );
    for (let t = 66; t <= 400; t += 66) {
      const f = buildFrame(t, MOUNTAIN);
      state = gate.update(f, extractor.extract(f, "left"), pose, "left");
    }
    expect(state.settled).toBe(true);
  });

  it("honours a custom velocity threshold", () => {
    const strict = new SettleGate({ velocityThreshold: 0.0001 });
    const state = holdStill(strict, 1500, (t) =>
      buildFrame(t, MOUNTAIN, { offset: { x: 0.001 * (t / 66), y: 0, z: 0 } }),
    );
    expect(state.settled).toBe(false);
  });

  it("clears its history on reset", () => {
    const gate = new SettleGate();
    expect(holdStill(gate, 1200).settled).toBe(true);
    gate.reset();
    const frame = buildFrame(5000, MOUNTAIN);
    expect(gate.update(frame, extractor.extract(frame, "left"), pose, "left").settled).toBe(false);
  });
});
