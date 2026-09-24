import { describe, expect, it } from "vitest";
import { parsePose, poseSchema, safeParsePose } from "../src/pose/schema.ts";

/** A minimal valid pose; tests clone and break one thing at a time. */
const validPose = () => ({
  id: "test-pose",
  name: "Test Pose",
  version: 1,
  view: "front" as const,
  sides: ["left", "right"],
  requiredLandmarks: ["left_hip", "right_hip", "left_knee", "right_knee"],
  settleShape: [{ feature: "torso_tilt", range: [0, 20] }],
  rules: [
    {
      id: "torso-upright",
      priority: "alignment",
      feature: "torso_tilt",
      range: [0, 10],
      hysteresis: 2,
      cues: { tooHigh: ["Stand tall."] } as { tooLow?: string[]; tooHigh?: string[] },
      highlight: ["left_hip", "right_hip"],
      weight: 1,
      source: "self",
    },
  ],
});

const broken = (mutate: (p: ReturnType<typeof validPose>) => void) => {
  const p = validPose();
  mutate(p);
  return safeParsePose(p);
};

describe("poseSchema accepts a well-formed pose", () => {
  it("parses and returns a typed pose", () => {
    const pose = parsePose(validPose());
    expect(pose.id).toBe("test-pose");
    expect(pose.rules[0]?.range).toEqual([0, 10]);
  });

  it("exposes the schema for reuse", () => {
    expect(poseSchema.safeParse(validPose()).success).toBe(true);
  });

  it("accepts side-relative feature and joint names", () => {
    const p = validPose();
    p.rules[0]!.feature = "front_knee_angle";
    p.rules[0]!.highlight = ["front_knee", "front_ankle"];
    expect(safeParsePose(p).success).toBe(true);
  });

  it("accepts an instructor-sourced rule", () => {
    const p = validPose();
    p.rules[0]!.source = "instructor";
    expect(safeParsePose(p).success).toBe(true);
  });

  it("accepts both cue directions at once", () => {
    const p = validPose();
    p.rules[0]!.cues = { tooLow: ["More."], tooHigh: ["Less."] };
    expect(safeParsePose(p).success).toBe(true);
  });
});

describe("poseSchema rejects malformed poses", () => {
  it("rejects an unknown feature name, catching typos at load time", () => {
    const r = broken((p) => {
      p.rules[0]!.feature = "torso_tlit";
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("torso_tlit");
  });

  it("rejects an unknown landmark in requiredLandmarks", () => {
    expect(broken((p) => p.requiredLandmarks.push("left_tail")).success).toBe(false);
  });

  it("rejects an unknown joint in highlight", () => {
    expect(broken((p) => p.rules[0]!.highlight.push("middle_knee")).success).toBe(false);
  });

  it("rejects an inverted range", () => {
    const r = broken((p) => {
      p.rules[0]!.range = [90, 10];
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/range/i);
  });

  it("rejects a range that is not a pair", () => {
    expect(broken((p) => ((p.rules[0] as { range: number[] }).range = [10])).success).toBe(false);
  });

  it("rejects negative hysteresis", () => {
    expect(
      broken((p) => {
        p.rules[0]!.hysteresis = -1;
      }).success,
    ).toBe(false);
  });

  it("rejects a non-positive weight, which would not contribute to the score", () => {
    expect(
      broken((p) => {
        p.rules[0]!.weight = 0;
      }).success,
    ).toBe(false);
  });

  it("rejects a rule with no cues at all: a failing rule must be able to speak", () => {
    expect(
      broken((p) => {
        p.rules[0]!.cues = {};
      }).success,
    ).toBe(false);
  });

  it("rejects an empty cue list", () => {
    expect(
      broken((p) => {
        p.rules[0]!.cues = { tooHigh: [] };
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate rule ids", () => {
    const r = broken((p) => p.rules.push({ ...p.rules[0]! }));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/duplicate/i);
  });

  it("rejects an unknown priority", () => {
    expect(
      broken((p) => {
        (p.rules[0] as { priority: string }).priority = "urgent";
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown source", () => {
    expect(
      broken((p) => {
        (p.rules[0] as { source: string }).source = "youtube";
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown view", () => {
    expect(
      broken((p) => {
        (p as { view: string }).view = "above";
      }).success,
    ).toBe(false);
  });

  it("rejects an empty rule list", () => {
    expect(
      broken((p) => {
        p.rules = [];
      }).success,
    ).toBe(false);
  });

  it("rejects an empty sides list", () => {
    expect(
      broken((p) => {
        p.sides = [];
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate sides", () => {
    expect(
      broken((p) => {
        p.sides = ["left", "left"];
      }).success,
    ).toBe(false);
  });

  it("rejects unknown top-level keys, catching silent typos", () => {
    expect(
      broken((p) => {
        (p as Record<string, unknown>).hysterisis = 3;
      }).success,
    ).toBe(false);
  });

  it("rejects unknown rule keys", () => {
    expect(
      broken((p) => {
        (p.rules[0] as Record<string, unknown>).prioritiy = "safety";
      }).success,
    ).toBe(false);
  });

  it("rejects a non-integer version", () => {
    expect(
      broken((p) => {
        p.version = 1.5;
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown feature in settleShape", () => {
    expect(
      broken((p) => {
        p.settleShape[0]!.feature = "not_a_feature";
      }).success,
    ).toBe(false);
  });

  it("rejects an id that is not a slug", () => {
    expect(
      broken((p) => {
        p.id = "Test Pose!";
      }).success,
    ).toBe(false);
  });

  it("throws on parsePose for invalid input", () => {
    expect(() => parsePose({ id: "x" })).toThrow();
  });
});

describe("settleShape", () => {
  it("may be empty: velocity alone can gate a pose", () => {
    const p = validPose();
    p.settleShape = [];
    expect(safeParsePose(p).success).toBe(true);
  });
});
