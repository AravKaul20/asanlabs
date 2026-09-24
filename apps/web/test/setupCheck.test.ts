import { describe, expect, it } from "vitest";
import { checkSetup } from "../lib/setupCheck.ts";
import { MOUNTAIN, buildFrame } from "@asan/core/testing";
import { warriorII } from "@asan/poses";
import { mountain } from "@asan/poses";
import type { LandmarkName } from "@asan/core";

const frameWith = (hidden: Partial<Record<LandmarkName, number>> = {}) =>
  buildFrame(0, MOUNTAIN, { visibility: hidden });

describe("checkSetup", () => {
  it("is ready when one whole body is visible", () => {
    const status = checkSetup({ poseCount: 1, frame: frameWith(), pose: mountain });
    expect(status).toEqual({ ready: true, message: null, missing: [] });
  });

  it("asks the user to step into frame when nobody is detected", () => {
    const status = checkSetup({ poseCount: 0, frame: null, pose: mountain });
    expect(status.ready).toBe(false);
    expect(status.message).toMatch(/step into frame/i);
  });

  it("asks the user to practise alone when it sees two people", () => {
    const status = checkSetup({ poseCount: 2, frame: frameWith(), pose: mountain });
    expect(status.ready).toBe(false);
    expect(status.message).toMatch(/more than one person/i);
  });

  it("names the feet when the ankles are cut off", () => {
    const status = checkSetup({
      poseCount: 1,
      frame: frameWith({ left_ankle: 0.1, right_ankle: 0.1 }),
      pose: mountain,
    });
    expect(status.message).toBe("Step back — I can't see your feet.");
    expect(status.missing).toEqual(["left_ankle", "right_ankle"]);
  });

  it("names the knees when only the knees are missing", () => {
    const status = checkSetup({
      poseCount: 1,
      frame: frameWith({ left_knee: 0.2 }),
      pose: mountain,
    });
    expect(status.message).toMatch(/knees/);
  });

  it("names the hips when only the hips are missing", () => {
    const status = checkSetup({
      poseCount: 1,
      frame: frameWith({ right_hip: 0.2 }),
      pose: mountain,
    });
    expect(status.message).toMatch(/hips/);
  });

  it("leads with the feet when several regions are missing at once", () => {
    // Everything below the waist gone: the actionable fix is still "step back".
    const status = checkSetup({
      poseCount: 1,
      frame: frameWith({ left_ankle: 0.1, left_knee: 0.1, left_hip: 0.1 }),
      pose: mountain,
    });
    expect(status.message).toMatch(/feet/);
  });

  it("mentions hands for a pose that needs them", () => {
    const status = checkSetup({
      poseCount: 1,
      frame: frameWith({ left_wrist: 0.1 }),
      pose: warriorII,
    });
    expect(status.message).toMatch(/hands/);
  });

  it("only judges the landmarks the chosen pose actually requires", () => {
    // Mountain does not require wrists, so a hidden wrist must not block setup.
    const status = checkSetup({
      poseCount: 1,
      frame: frameWith({ left_wrist: 0.1 }),
      pose: mountain,
    });
    expect(status.ready).toBe(true);
  });

  it("treats exactly 0.5 visibility as good enough, matching the engine", () => {
    const status = checkSetup({
      poseCount: 1,
      frame: frameWith({ left_ankle: 0.5 }),
      pose: mountain,
    });
    expect(status.ready).toBe(true);
  });

  it("gives plain language with no landmark names or numbers", () => {
    const status = checkSetup({
      poseCount: 1,
      frame: frameWith({ left_ankle: 0.1 }),
      pose: mountain,
    });
    expect(status.message).not.toMatch(/left_|0\.|visibility/);
  });
});
