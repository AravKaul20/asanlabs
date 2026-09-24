import { describe, expect, it } from "vitest";
import {
  FeatureExtractor,
  RuleEngine,
  isFormCorrect,
  parsePose,
  type PoseDefinition,
  type Side,
} from "@asan/core";
import {
  MOUNTAIN,
  WARRIOR_II_LEFT,
  WARRIOR_II_RIGHT,
  buildFrame,
  withJoints,
  type Joints,
} from "@asan/core/testing";
import { POSES, POSE_IDS, getPose, mountain, warriorII } from "../index.ts";

const extractor = new FeatureExtractor();
const engine = new RuleEngine();

/** Judge a single skeleton against a pose, with no previous frame. */
function judge(joints: Joints, pose: PoseDefinition, side: Side) {
  const frame = buildFrame(0, joints);
  return engine.evaluate(extractor.extract(frame, side), pose, side, null);
}

const failing = (joints: Joints, pose: PoseDefinition, side: Side) =>
  judge(joints, pose, side)
    .results.filter((r) => r.status !== "pass" && r.status !== "skipped")
    .map((r) => r.ruleId);

describe("the pose library", () => {
  it("exposes Mountain and Warrior II", () => {
    expect(POSE_IDS).toEqual(["mountain", "warrior-ii"]);
  });

  it("looks a pose up by id", () => {
    expect(getPose("warrior-ii")?.name).toBe("Warrior II");
    expect(getPose("nope")).toBeUndefined();
  });

  it("validates every pose against the schema at import time", () => {
    for (const pose of POSES) {
      expect(() => parsePose(pose)).not.toThrow();
    }
  });

  it("gives every pose 3 to 5 rules", () => {
    for (const pose of POSES) {
      expect(pose.rules.length).toBeGreaterThanOrEqual(3);
      expect(pose.rules.length).toBeLessThanOrEqual(5);
    }
  });

  it("marks every rule as self-sourced", () => {
    for (const pose of POSES) {
      for (const rule of pose.rules) expect(rule.source).toBe("self");
    }
  });

  it("includes at least one safety rule across the library", () => {
    const safety = POSES.flatMap((p) => p.rules.filter((r) => r.priority === "safety"));
    expect(safety.length).toBeGreaterThanOrEqual(1);
  });

  it("uses the front view for both poses", () => {
    for (const pose of POSES) expect(pose.view).toBe("front");
  });

  it("offers both sides for both poses", () => {
    for (const pose of POSES) expect([...pose.sides].sort()).toEqual(["left", "right"]);
  });

  it("gives every rule a positive weight and a non-negative deadband", () => {
    for (const pose of POSES) {
      for (const rule of pose.rules) {
        expect(rule.weight).toBeGreaterThan(0);
        expect(rule.hysteresis).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("keeps every hysteresis band smaller than its range, so a rule can still pass", () => {
    for (const pose of POSES) {
      for (const rule of pose.rules) {
        const [min, max] = rule.range;
        expect(rule.hysteresis).toBeLessThan(max - min);
      }
    }
  });

  it("avoids medical or injury claims in cue wording", () => {
    const banned = /\b(injur|rehab|treat|heal|prevent|diagnos|therap)/i;
    for (const pose of POSES) {
      for (const rule of pose.rules) {
        for (const text of [...(rule.cues.tooLow ?? []), ...(rule.cues.tooHigh ?? [])]) {
          expect(text, `"${text}" in ${pose.id}/${rule.id}`).not.toMatch(banned);
        }
      }
    }
  });
});

describe("Mountain", () => {
  it("passes every rule on a correct Mountain", () => {
    const result = judge(MOUNTAIN, mountain, "left");
    expect(failing(MOUNTAIN, mountain, "left")).toEqual([]);
    expect(result.score).toBe(100);
    expect(isFormCorrect(result)).toBe(true);
  });

  it("judges every rule rather than skipping any on a fully visible body", () => {
    const result = judge(MOUNTAIN, mountain, "left");
    expect(result.results.every((r) => r.status !== "skipped")).toBe(true);
  });

  it("flags a leaning torso as an alignment fault", () => {
    const leaning = withJoints(MOUNTAIN, {
      left_shoulder: { x: -0.06, y: -0.48, z: 0 },
      right_shoulder: { x: 0.3, y: -0.48, z: 0 },
    });
    expect(failing(leaning, mountain, "left")).toContain("torso-upright");
  });

  it("escalates a big lean to the safety rule", () => {
    const falling = withJoints(MOUNTAIN, {
      left_shoulder: { x: 0.14, y: -0.42, z: 0 },
      right_shoulder: { x: 0.5, y: -0.42, z: 0 },
    });
    const ids = failing(falling, mountain, "left");
    expect(ids).toContain("off-balance");
    expect(ids).toContain("torso-upright");
  });

  it("flags a bent knee", () => {
    const bent = withJoints(MOUNTAIN, { left_knee: { x: -0.16, y: 0.44, z: 0.12 } });
    expect(failing(bent, mountain, "left")).toContain("left-leg-straight");
  });

  it("flags raised arms as a refinement, not a fault worth interrupting for", () => {
    const raised = withJoints(MOUNTAIN, {
      left_elbow: { x: -0.4, y: -0.5, z: 0 },
      left_wrist: { x: -0.62, y: -0.5, z: 0 },
    });
    const ids = failing(raised, mountain, "left");
    expect(ids).toContain("arms-by-sides");
    const rule = mountain.rules.find((r) => r.id === "arms-by-sides");
    expect(rule?.priority).toBe("refinement");
  });

  it("reads the same on either side, since Mountain is symmetric", () => {
    expect(judge(MOUNTAIN, mountain, "left").score).toBe(judge(MOUNTAIN, mountain, "right").score);
  });
});

describe("Warrior II", () => {
  it("passes every rule on a correct Warrior II, right leg forward", () => {
    const result = judge(WARRIOR_II_RIGHT, warriorII, "right");
    expect(failing(WARRIOR_II_RIGHT, warriorII, "right")).toEqual([]);
    expect(result.score).toBe(100);
  });

  it("passes the mirrored pose with the side flipped", () => {
    expect(failing(WARRIOR_II_LEFT, warriorII, "left")).toEqual([]);
  });

  it("scores the mirrored pose identically, so the side abstraction holds", () => {
    expect(judge(WARRIOR_II_LEFT, warriorII, "left").score).toBeCloseTo(
      judge(WARRIOR_II_RIGHT, warriorII, "right").score,
      6,
    );
  });

  it("fails on a correct pose judged with the wrong side, since the legs swap roles", () => {
    expect(failing(WARRIOR_II_RIGHT, warriorII, "left").length).toBeGreaterThan(0);
  });

  it("catches the front knee driven past the ankle as a safety fault", () => {
    const overshoot = withJoints(WARRIOR_II_RIGHT, { right_knee: { x: 0.72, y: 0.04, z: 0 } });
    const ids = failing(overshoot, warriorII, "right");
    expect(ids).toContain("front-knee-over-ankle");
    const rule = warriorII.rules.find((r) => r.id === "front-knee-over-ankle");
    expect(rule?.priority).toBe("safety");
  });

  it("gives the front-knee safety rule the heaviest weight", () => {
    const weights = warriorII.rules.map((r) => r.weight);
    const safety = warriorII.rules.find((r) => r.id === "front-knee-over-ankle");
    expect(safety?.weight).toBe(Math.max(...weights));
  });

  it("catches a front knee that has not travelled out over the ankle", () => {
    const shy = withJoints(WARRIOR_II_RIGHT, { right_knee: { x: 0.32, y: 0.06, z: 0 } });
    expect(failing(shy, warriorII, "right")).toContain("front-knee-over-ankle");
  });

  it("catches a front knee that is barely bent", () => {
    const straight = withJoints(WARRIOR_II_RIGHT, {
      right_knee: { x: 0.31, y: 0.26, z: 0 },
      right_ankle: { x: 0.52, y: 0.5, z: 0 },
    });
    expect(failing(straight, warriorII, "right")).toContain("front-knee-bend");
  });

  it("catches a bent back leg", () => {
    const bent = withJoints(WARRIOR_II_RIGHT, { left_knee: { x: -0.46, y: 0.2, z: 0.24 } });
    expect(failing(bent, warriorII, "right")).toContain("back-leg-straight");
  });

  it("catches uneven arms", () => {
    const uneven = withJoints(WARRIOR_II_RIGHT, {
      right_elbow: { x: 0.44, y: -0.31, z: 0 },
      right_wrist: { x: 0.7, y: -0.12, z: 0 },
    });
    expect(failing(uneven, warriorII, "right")).toContain("arms-level");
  });

  it("catches leaning out over the front leg", () => {
    const leaning = withJoints(WARRIOR_II_RIGHT, {
      left_shoulder: { x: -0.04, y: -0.47, z: 0 },
      right_shoulder: { x: 0.32, y: -0.47, z: 0 },
    });
    expect(failing(leaning, warriorII, "right")).toContain("torso-upright");
  });

  it("lets the safety rule win the cue when several faults coexist", () => {
    const messy = withJoints(WARRIOR_II_RIGHT, {
      right_knee: { x: 0.74, y: 0.04, z: 0 },
      left_knee: { x: -0.46, y: 0.2, z: 0.24 },
    });
    const result = judge(messy, warriorII, "right");
    const worst = result.results
      .filter((r) => r.status === "tooLow" || r.status === "tooHigh")
      .sort((a, b) => (a.priority === "safety" ? -1 : b.priority === "safety" ? 1 : 0))[0];
    expect(worst?.ruleId).toBe("front-knee-over-ankle");
  });

  it("resolves side-relative highlights to the active side's joints", () => {
    const result = judge(WARRIOR_II_RIGHT, warriorII, "right");
    const safety = result.results.find((r) => r.ruleId === "front-knee-over-ankle");
    expect(safety?.highlight).toEqual(["right_hip", "right_knee", "right_ankle"]);
    const mirrored = judge(WARRIOR_II_LEFT, warriorII, "left").results.find(
      (r) => r.ruleId === "front-knee-over-ankle",
    );
    expect(mirrored?.highlight).toEqual(["left_hip", "left_knee", "left_ankle"]);
  });
});

describe("settle shapes", () => {
  it("accepts the correct pose for each", () => {
    const cases: Array<[PoseDefinition, Joints, Side]> = [
      [mountain, MOUNTAIN, "left"],
      [warriorII, WARRIOR_II_RIGHT, "right"],
    ];
    for (const [pose, joints, side] of cases) {
      const features = extractor.extract(buildFrame(0, joints), side);
      for (const shape of pose.settleShape) {
        const name = shape.feature
          .replace(/^front_/, `${side}_`)
          .replace(/^back_/, side === "left" ? "right_" : "left_");
        const value = features.values[name]?.value ?? Number.NaN;
        expect(value, `${pose.id}: ${shape.feature}`).toBeGreaterThanOrEqual(shape.range[0]);
        expect(value, `${pose.id}: ${shape.feature}`).toBeLessThanOrEqual(shape.range[1]);
      }
    }
  });

  it("is looser than the rules it gates, so entering the pose does not require perfection", () => {
    // Warrior II's settle band for the front knee must admit more than the rule does.
    const shape = warriorII.settleShape.find((s) => s.feature === "front_knee_angle");
    const rule = warriorII.rules.find((r) => r.id === "front-knee-bend");
    expect(shape?.range[0]).toBeLessThan(rule!.range[0]);
    expect(shape?.range[1]).toBeGreaterThan(rule!.range[1]);
  });
});

describe("rules must be reachable through the settle gate", () => {
  /**
   * A rule is only ever judged while the settle gate holds, and the gate holds
   * only while every settleShape range passes. So if a rule's failing region sits
   * outside the settle band for the same feature, the gate drops out before the
   * fault can be seen and the rule is dead code.
   *
   * This caught Mountain's safety rule: the gate capped torso tilt at 15 degrees
   * while the rule only fired past 20, so it could never fire at all.
   */
  it("can reach every cue direction of every rule", () => {
    for (const pose of POSES) {
      for (const rule of pose.rules) {
        const shape = pose.settleShape.find((s) => s.feature === rule.feature);
        if (!shape) continue; // unconstrained by the gate
        const [settleMin, settleMax] = shape.range;
        const [ruleMin, ruleMax] = rule.range;

        if (rule.cues.tooHigh) {
          expect(
            ruleMax,
            `${pose.id}/${rule.id}: tooHigh unreachable, settle caps ${rule.feature} at ${settleMax}`,
          ).toBeLessThan(settleMax);
        }
        if (rule.cues.tooLow) {
          expect(
            ruleMin,
            `${pose.id}/${rule.id}: tooLow unreachable, settle floors ${rule.feature} at ${settleMin}`,
          ).toBeGreaterThan(settleMin);
        }
      }
    }
  });

  it("keeps each settle band at least as wide as the rules it gates", () => {
    for (const pose of POSES) {
      for (const rule of pose.rules) {
        const shape = pose.settleShape.find((s) => s.feature === rule.feature);
        if (!shape) continue;
        expect(shape.range[0], `${pose.id}/${rule.id}`).toBeLessThanOrEqual(rule.range[0]);
        expect(shape.range[1], `${pose.id}/${rule.id}`).toBeGreaterThanOrEqual(rule.range[1]);
      }
    }
  });
});
