/**
 * Drives the whole web pipeline with synthetic frames — no camera, no browser.
 * This is the closest thing to an end-to-end test of what /practice does.
 */
import { describe, expect, it } from "vitest";
import { PracticeSession, poseUsesSides } from "../lib/session.ts";
import type { Speaker } from "../lib/voice.ts";
import type { DetectResult } from "../lib/poseLandmarker.ts";
import {
  MOUNTAIN,
  WARRIOR_II_RIGHT,
  buildFrame,
  withJoints,
  type Joints,
} from "@asan/core/testing";
import { mountain, warriorII } from "@asan/poses";
import type { LandmarkName } from "@asan/core";

class FakeVoice implements Speaker {
  spoken: string[] = [];
  say(text: string): void {
    this.spoken.push(text);
  }
  cancel(): void {}
}

const detect = (
  joints: Joints,
  t: number,
  poseCount = 1,
  hidden: Partial<Record<LandmarkName, number>> = {},
): DetectResult => ({
  frame: buildFrame(t, joints, { visibility: hidden }),
  poseCount,
});

/** Feed a stretch of identical frames and return the final state. */
function hold(
  session: PracticeSession,
  joints: Joints,
  from: number,
  to: number,
  poseCount = 1,
  hidden: Partial<Record<LandmarkName, number>> = {},
) {
  let state = session.process(detect(joints, from, poseCount, hidden), from);
  for (let t = from + 66; t <= to; t += 66) {
    state = session.process(detect(joints, t, poseCount, hidden), t);
  }
  return state;
}

/**
 * A 26 degree lean: past the off-balance safety rule at 20, but still inside
 * Mountain's 35 degree settle band, so the gate still recognises the pose and
 * keeps coaching. Lean much further and the gate correctly decides this is not
 * Mountain any more and stops judging entirely.
 */
/**
 * Move between two shapes over a duration, the way a body actually does.
 *
 * Teleporting between poses in one frame is 5 m/s of landmark velocity, which
 * correctly drops the settle gate and wipes the active cue — so the confirmation
 * for a fix would be lost. Real corrections are gradual and the gate holds
 * through them.
 */
function ramp(
  session: PracticeSession,
  from: Joints,
  to: Joints,
  startT: number,
  durationMs: number,
) {
  let state = session.process(detect(from, startT), startT);
  for (let t = startT + 66; t <= startT + durationMs; t += 66) {
    const u = Math.min(1, (t - startT) / durationMs);
    const blended = Object.fromEntries(
      Object.entries(from).map(([name, p]) => {
        const q = (to as Record<string, typeof p>)[name]!;
        return [
          name,
          { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u, z: p.z + (q.z - p.z) * u },
        ];
      }),
    ) as Joints;
    state = session.process(detect(blended, t), t);
  }
  return state;
}

const LEANING = withJoints(MOUNTAIN, {
  left_shoulder: { x: 0.064, y: -0.5, z: 0 },
  right_shoulder: { x: 0.424, y: -0.5, z: 0 },
});

describe("setup gating", () => {
  it("asks the user into frame before coaching anything", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    const state = session.process({ frame: null, poseCount: 0 }, 0);
    expect(state.setup.ready).toBe(false);
    expect(state.message).toBeNull();
    expect(voice.spoken).toEqual([]);
  });

  it("says nothing while two people are in frame", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    hold(session, LEANING, 0, 4000, 2);
    expect(voice.spoken).toEqual([]);
  });

  it("does not coach while a required joint is out of frame", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    const state = hold(session, LEANING, 0, 4000, 1, { left_ankle: 0.1 });
    expect(state.setup.ready).toBe(false);
    expect(voice.spoken).toEqual([]);
  });
});

describe("settling before judging", () => {
  it("does not judge in the first second, while the gate is still waiting", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    const state = hold(session, MOUNTAIN, 0, 800);
    expect(state.settled).toBe(false);
    expect(state.ruleStates).toEqual([]);
  });

  it("settles on a still, correct pose and judges every rule", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    const state = hold(session, MOUNTAIN, 0, 2000);
    expect(state.settled).toBe(true);
    expect(state.ruleStates.length).toBe(mountain.rules.length);
  });

  it("stays silent through a correct hold", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    const state = hold(session, MOUNTAIN, 0, 6000);
    expect(voice.spoken).toEqual([]);
    expect(state.message).toBeNull();
  });
});

describe("coaching a fault", () => {
  it("speaks one cue, and shows the same words it spoke", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    hold(session, MOUNTAIN, 0, 2000);
    const state = hold(session, LEANING, 2066, 6000);
    expect(voice.spoken.length).toBeGreaterThan(0);
    expect(state.message).toBe(voice.spoken[voice.spoken.length - 1]);
  });

  it("prefers the safety cue when a safety rule is failing", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    hold(session, MOUNTAIN, 0, 2000);
    hold(session, LEANING, 2066, 6000);
    const safety = mountain.rules.find((r) => r.id === "off-balance");
    expect(safety?.cues.tooHigh).toContain(voice.spoken[0]);
  });

  it("highlights the joints belonging to the active cue", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    hold(session, MOUNTAIN, 0, 2000);
    const state = hold(session, LEANING, 2066, 6000);
    expect(state.highlight.length).toBeGreaterThan(0);
  });

  it("does not nag: one cue over several seconds of the same fault", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    hold(session, MOUNTAIN, 0, 2000);
    hold(session, LEANING, 2066, 9000);
    // 7 s of a held fault, and the 8 s repeat guard permits at most one repeat.
    expect(voice.spoken.length).toBeLessThanOrEqual(2);
  });

  it('confirms with "Good." once the fault is corrected', () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    hold(session, MOUNTAIN, 0, 2000);
    ramp(session, MOUNTAIN, LEANING, 2066, 1200);
    hold(session, LEANING, 3300, 6000);
    ramp(session, LEANING, MOUNTAIN, 6066, 1200);
    const state = hold(session, MOUNTAIN, 7300, 9000);
    expect(voice.spoken).toContain("Good.");
    expect(state.messageKind === "confirmation" || state.message === null).toBe(true);
  });

  it("clears the confirmation from the screen after a moment", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    hold(session, MOUNTAIN, 0, 2000);
    ramp(session, MOUNTAIN, LEANING, 2066, 1200);
    hold(session, LEANING, 3300, 6000);
    ramp(session, LEANING, MOUNTAIN, 6066, 1200);
    const state = hold(session, MOUNTAIN, 7300, 14000);
    expect(state.message).toBeNull();
  });
});

describe("hold timer and score", () => {
  it("counts hold seconds only while form is correct", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    const good = hold(session, MOUNTAIN, 0, 5000);
    const heldAfterGood = good.holdSeconds;
    expect(heldAfterGood).toBeGreaterThan(2);

    const faulty = hold(session, LEANING, 5066, 10000);
    // The lean must not add to the hold, though a little is credited while the
    // body is still crossing out of the correct range.
    expect(faulty.holdSeconds).toBeLessThan(heldAfterGood + 1);
  });

  it("scores a clean hold at 100", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    const state = hold(session, MOUNTAIN, 0, 5000);
    expect(state.score).toBeCloseTo(100, 6);
    expect(state.instantScore).toBe(100);
  });

  it("drops the score while a rule is failing", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    hold(session, MOUNTAIN, 0, 3000);
    const state = hold(session, LEANING, 3066, 9000);
    expect(state.instantScore).toBeLessThan(100);
    expect(state.score).toBeLessThan(100);
  });
});

describe("Warrior II and sides", () => {
  it("coaches Warrior II on the right side without complaint", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(warriorII, "right", voice);
    const state = hold(session, WARRIOR_II_RIGHT, 0, 5000);
    expect(state.settled).toBe(true);
    expect(state.instantScore).toBe(100);
    expect(voice.spoken).toEqual([]);
  });

  it("catches the front knee pushed past the ankle", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(warriorII, "right", voice);
    hold(session, WARRIOR_II_RIGHT, 0, 2000);
    const overshoot = withJoints(WARRIOR_II_RIGHT, { right_knee: { x: 0.74, y: 0.04, z: 0 } });
    hold(session, overshoot, 2066, 7000);
    const safety = warriorII.rules.find((r) => r.id === "front-knee-over-ankle");
    expect(safety?.cues.tooHigh).toContain(voice.spoken[0]);
  });

  it("knows Warrior II is side-dependent and Mountain is not", () => {
    expect(poseUsesSides(warriorII)).toBe(true);
    expect(poseUsesSides(mountain)).toBe(false);
  });
});

describe("reset", () => {
  it("clears the hold, score and any active cue", () => {
    const voice = new FakeVoice();
    const session = new PracticeSession(mountain, "left", voice);
    hold(session, MOUNTAIN, 0, 3000);
    hold(session, LEANING, 3066, 7000);
    session.reset();
    const state = session.process(detect(MOUNTAIN, 8000), 8000);
    expect(state.holdSeconds).toBe(0);
    expect(state.message).toBeNull();
    expect(state.settled).toBe(false);
  });
});
