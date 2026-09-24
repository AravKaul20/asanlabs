import { describe, expect, it } from "vitest";
import { FeatureExtractor, FEATURE_NAMES, featureLandmarks } from "../src/features/extractor.ts";
import {
  buildFrame,
  MOUNTAIN,
  WARRIOR_II_LEFT,
  WARRIOR_II_RIGHT,
  withJoints,
} from "./fixtures/skeleton.ts";

const extractor = new FeatureExtractor();
const val = (f: ReturnType<FeatureExtractor["extract"]>, name: string) => f.values[name]?.value;

describe("FeatureExtractor on Mountain", () => {
  const features = extractor.extract(buildFrame(0, MOUNTAIN), "left");

  it("reads both knees as nearly straight", () => {
    expect(val(features, "left_knee_angle")).toBeGreaterThan(175);
    expect(val(features, "right_knee_angle")).toBeGreaterThan(175);
  });

  it("reads an upright torso as zero tilt", () => {
    expect(val(features, "torso_tilt")).toBeCloseTo(0, 3);
  });

  it("reads arms hanging at the sides as a small shoulder angle", () => {
    expect(val(features, "left_shoulder_angle")).toBeLessThan(25);
    expect(val(features, "right_shoulder_angle")).toBeLessThan(25);
  });

  it("reads hips as nearly open", () => {
    expect(val(features, "left_hip_angle")).toBeGreaterThan(160);
  });

  it("reads knees stacked over ankles as zero offset", () => {
    expect(val(features, "left_knee_over_ankle")).toBeCloseTo(0, 3);
    expect(val(features, "right_knee_over_ankle")).toBeCloseTo(0, 3);
  });

  it("produces every registered feature", () => {
    for (const name of FEATURE_NAMES) {
      expect(features.values[name], `missing feature ${name}`).toBeDefined();
      expect(Number.isNaN(features.values[name]?.value)).toBe(false);
    }
  });
});

describe("FeatureExtractor on Warrior II (right leg forward)", () => {
  const features = extractor.extract(buildFrame(0, WARRIOR_II_RIGHT), "right");

  it("reads the bent front knee near a right angle", () => {
    expect(val(features, "right_knee_angle")).toBeCloseTo(95, 0);
  });

  it("reads the straight back leg as nearly straight", () => {
    expect(val(features, "left_knee_angle")).toBeGreaterThan(172);
  });

  it("reads level arms as no deviation from horizontal", () => {
    expect(val(features, "arm_line_deviation")).toBeCloseTo(0, 3);
  });

  it("reads the front knee as stacked over the ankle", () => {
    expect(Math.abs(val(features, "right_knee_over_ankle") ?? 99)).toBeLessThan(0.05);
  });

  it("reads arms spread wide as a shoulder angle near 100 degrees", () => {
    expect(val(features, "right_shoulder_angle")).toBeCloseTo(100, 0);
    expect(val(features, "right_elbow_angle")).toBeGreaterThan(175);
  });
});

describe("side abstraction", () => {
  it("maps front_* to the named side and back_* to the other", () => {
    const f = extractor.extract(buildFrame(0, WARRIOR_II_RIGHT), "right");
    expect(val(f, "front_knee_angle")).toBe(val(f, "right_knee_angle"));
    expect(val(f, "back_knee_angle")).toBe(val(f, "left_knee_angle"));
  });

  it("flips which limb is front when the side flips", () => {
    const f = extractor.extract(buildFrame(0, WARRIOR_II_RIGHT), "left");
    expect(val(f, "front_knee_angle")).toBe(val(f, "left_knee_angle"));
    expect(val(f, "back_knee_angle")).toBe(val(f, "right_knee_angle"));
  });

  it("gives a mirrored pose the same front/back readings", () => {
    const right = extractor.extract(buildFrame(0, WARRIOR_II_RIGHT), "right");
    const left = extractor.extract(buildFrame(0, WARRIOR_II_LEFT), "left");
    for (const name of ["front_knee_angle", "back_knee_angle", "front_knee_over_ankle"]) {
      expect(val(left, name)).toBeCloseTo(val(right, name) ?? Number.NaN, 6);
    }
  });

  it("aliases offsets too, keeping the sign convention", () => {
    const f = extractor.extract(buildFrame(0, WARRIOR_II_RIGHT), "right");
    expect(val(f, "front_knee_over_ankle")).toBe(val(f, "right_knee_over_ankle"));
  });

  it("records the active side on the result", () => {
    expect(extractor.extract(buildFrame(0, MOUNTAIN), "left").side).toBe("left");
  });
});

describe("knee-over-ankle sign and normalization", () => {
  it("is positive when the knee juts past the ankle, away from the body", () => {
    // Warrior II fault: front knee driven out beyond the ankle.
    const faulty = withJoints(WARRIOR_II_RIGHT, { right_knee: { x: 0.68, y: 0.02, z: 0 } });
    const f = extractor.extract(buildFrame(0, faulty), "right");
    expect(val(f, "right_knee_over_ankle")).toBeGreaterThan(0.1);
  });

  it("is negative when the knee lags behind the ankle", () => {
    const shy = withJoints(WARRIOR_II_RIGHT, { right_knee: { x: 0.3, y: 0.02, z: 0 } });
    const f = extractor.extract(buildFrame(0, shy), "right");
    expect(val(f, "right_knee_over_ankle")).toBeLessThan(-0.1);
  });

  it("is scale invariant: a bigger body of the same shape reads the same", () => {
    const scale = (j: typeof WARRIOR_II_RIGHT, k: number) =>
      Object.fromEntries(
        Object.entries(j).map(([n, p]) => [n, { x: p.x * k, y: p.y * k, z: p.z * k }]),
      ) as typeof WARRIOR_II_RIGHT;
    const faulty = withJoints(WARRIOR_II_RIGHT, { right_knee: { x: 0.68, y: 0.02, z: 0 } });
    const small = extractor.extract(buildFrame(0, faulty), "right");
    const big = extractor.extract(buildFrame(0, scale(faulty, 1.35)), "right");
    expect(val(big, "right_knee_over_ankle")).toBeCloseTo(
      val(small, "right_knee_over_ankle") ?? Number.NaN,
      6,
    );
  });
});

describe("torso tilt", () => {
  it("rises as the torso leans", () => {
    const leaning = withJoints(MOUNTAIN, {
      left_shoulder: { x: -0.05, y: -0.49, z: 0 },
      right_shoulder: { x: 0.31, y: -0.49, z: 0 },
    });
    const f = extractor.extract(buildFrame(0, leaning), "left");
    expect(val(f, "torso_tilt")).toBeGreaterThan(10);
  });
});

describe("visibility propagation", () => {
  it("reports the weakest contributing landmark's visibility", () => {
    const frame = buildFrame(0, MOUNTAIN, { visibility: { left_ankle: 0.2 } });
    const f = extractor.extract(frame, "left");
    expect(f.values["left_knee_angle"]?.minVisibility).toBeCloseTo(0.2, 6);
    // A feature that does not depend on the ankle is unaffected.
    expect(f.values["left_elbow_angle"]?.minVisibility).toBeCloseTo(1, 6);
  });

  it("carries visibility through side aliases", () => {
    const frame = buildFrame(0, MOUNTAIN, { visibility: { right_knee: 0.1 } });
    const f = extractor.extract(frame, "right");
    expect(f.values["front_knee_angle"]?.minVisibility).toBeCloseTo(0.1, 6);
  });

  it("exposes which landmarks a feature depends on", () => {
    expect(featureLandmarks("left_knee_angle")).toEqual(["left_hip", "left_knee", "left_ankle"]);
    expect(featureLandmarks("front_knee_angle", "right")).toEqual([
      "right_hip",
      "right_knee",
      "right_ankle",
    ]);
  });

  it("returns undefined for an unknown feature", () => {
    const f = extractor.extract(buildFrame(0, MOUNTAIN), "left");
    expect(f.values["no_such_feature"]).toBeUndefined();
    expect(featureLandmarks("no_such_feature")).toBeUndefined();
  });
});
