import { describe, expect, it } from "vitest";
import {
  angleAtDeg,
  angleBetweenDeg,
  angleFromHorizontalDeg,
  horizontalDistance,
  midpoint,
  normalizeVec,
  sub,
  tiltFromVerticalDeg,
  WORLD_UP,
} from "../src/geometry.ts";

const v = (x: number, y: number, z: number) => ({ x, y, z });

describe("angleAtDeg", () => {
  it("measures a right angle at the vertex", () => {
    // vertex at origin, one arm along +x, the other along +y
    expect(angleAtDeg(v(1, 0, 0), v(0, 0, 0), v(0, 1, 0))).toBeCloseTo(90, 6);
  });

  it("measures a straight limb as 180 degrees", () => {
    expect(angleAtDeg(v(-1, 0, 0), v(0, 0, 0), v(1, 0, 0))).toBeCloseTo(180, 6);
  });

  it("measures a fully folded limb as 0 degrees", () => {
    expect(angleAtDeg(v(1, 0, 0), v(0, 0, 0), v(2, 0, 0))).toBeCloseTo(0, 6);
  });

  it("is independent of the vertex position", () => {
    expect(angleAtDeg(v(6, 5, 5), v(5, 5, 5), v(5, 6, 5))).toBeCloseTo(90, 6);
  });

  it("uses 3D, not a 2D projection", () => {
    // Collapsing z would make this look like 180 degrees.
    expect(angleAtDeg(v(-1, 0, 0), v(0, 0, 0), v(1, 0, 1))).toBeCloseTo(135, 6);
  });

  it("returns NaN for a degenerate (zero-length) limb", () => {
    expect(angleAtDeg(v(0, 0, 0), v(0, 0, 0), v(1, 0, 0))).toBeNaN();
  });
});

describe("world axis convention", () => {
  it("treats -y as up, matching MediaPipe's image-aligned world axes", () => {
    expect(WORLD_UP).toEqual({ x: 0, y: -1, z: 0 });
  });
});

describe("tiltFromVerticalDeg", () => {
  it("is 0 for a perfectly upright torso", () => {
    // hips at origin, shoulders 0.5 m above => negative y
    expect(tiltFromVerticalDeg(sub(v(0, -0.5, 0), v(0, 0, 0)))).toBeCloseTo(0, 6);
  });

  it("is 45 degrees for a torso leaning sideways by its own height", () => {
    expect(tiltFromVerticalDeg(v(0.5, -0.5, 0))).toBeCloseTo(45, 6);
  });

  it("is 90 degrees for a horizontal torso", () => {
    expect(tiltFromVerticalDeg(v(0.5, 0, 0))).toBeCloseTo(90, 6);
  });

  it("is unsigned: leaning left and right read the same", () => {
    expect(tiltFromVerticalDeg(v(-0.3, -0.5, 0))).toBeCloseTo(
      tiltFromVerticalDeg(v(0.3, -0.5, 0)),
      6,
    );
  });

  it("counts forward lean out of the frontal plane", () => {
    expect(tiltFromVerticalDeg(v(0, -0.5, 0.5))).toBeCloseTo(45, 6);
  });
});

describe("angleFromHorizontalDeg", () => {
  it("is 0 for a level arm line", () => {
    expect(angleFromHorizontalDeg(v(1, 0, 0))).toBeCloseTo(0, 6);
  });

  it("is 45 when one hand is as far up as the arms are wide", () => {
    expect(angleFromHorizontalDeg(v(1, -1, 0))).toBeCloseTo(45, 6);
  });

  it("is unsigned: either hand high reads the same", () => {
    expect(angleFromHorizontalDeg(v(1, 0.5, 0))).toBeCloseTo(
      angleFromHorizontalDeg(v(1, -0.5, 0)),
      6,
    );
  });

  it("is 90 for a vertical line", () => {
    expect(angleFromHorizontalDeg(v(0, 1, 0))).toBeCloseTo(90, 6);
  });
});

describe("helpers", () => {
  it("midpoint averages componentwise", () => {
    expect(midpoint(v(0, 0, 0), v(2, -4, 6))).toEqual({ x: 1, y: -2, z: 3 });
  });

  it("horizontalDistance ignores the vertical axis", () => {
    expect(horizontalDistance(v(0, 0, 0), v(3, 100, 4))).toBeCloseTo(5, 6);
  });

  it("normalizeVec returns a unit vector", () => {
    const n = normalizeVec(v(0, 3, 4));
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 6);
  });

  it("angleBetweenDeg is symmetric", () => {
    expect(angleBetweenDeg(v(1, 0, 0), v(0, 1, 0))).toBeCloseTo(90, 6);
    expect(angleBetweenDeg(v(0, 1, 0), v(1, 0, 0))).toBeCloseTo(90, 6);
  });
});
