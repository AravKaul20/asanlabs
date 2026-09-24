import { describe, expect, it } from "vitest";
import { RuleEngine } from "../src/ruleEngine.ts";
import { parsePose } from "../src/pose/schema.ts";
import type { EvalResult, Features, FeatureValue, Side } from "../src/types.ts";
import { clone } from "./support/clone.ts";

const engine = new RuleEngine();

/** Build a Features object directly, for precise control over values and visibility. */
function features(
  values: Record<string, number | [number, number]>,
  side: Side = "right",
  t = 0,
): Features {
  const out: Record<string, FeatureValue> = {};
  for (const [name, v] of Object.entries(values)) {
    const [value, minVisibility] = Array.isArray(v) ? v : [v, 1];
    out[name] = { value, minVisibility };
  }
  return { t, side, values: out };
}

const pose = (rules: unknown[]) =>
  parsePose({
    id: "p",
    name: "P",
    version: 1,
    view: "front",
    sides: ["left", "right"],
    requiredLandmarks: ["left_hip", "right_hip"],
    settleShape: [],
    rules,
  });

const rule = (over: Record<string, unknown> = {}) => ({
  id: "knee",
  priority: "alignment",
  feature: "right_knee_angle",
  range: [80, 100],
  hysteresis: 0,
  cues: { tooLow: ["Bend more."], tooHigh: ["Straighten."] },
  highlight: ["right_knee"],
  weight: 1,
  source: "self",
  ...over,
});

const statusOf = (r: EvalResult, id: string) => r.results.find((x) => x.ruleId === id)?.status;

describe("RuleEngine basic judgement", () => {
  it("passes a value inside the range", () => {
    const r = engine.evaluate(features({ right_knee_angle: 90 }), pose([rule()]), "right", null);
    expect(statusOf(r, "knee")).toBe("pass");
    expect(r.score).toBe(100);
    expect(r.judged).toBe(true);
  });

  it("reports tooLow below the range", () => {
    const r = engine.evaluate(features({ right_knee_angle: 60 }), pose([rule()]), "right", null);
    expect(statusOf(r, "knee")).toBe("tooLow");
    expect(r.score).toBe(0);
  });

  it("reports tooHigh above the range", () => {
    const r = engine.evaluate(features({ right_knee_angle: 140 }), pose([rule()]), "right", null);
    expect(statusOf(r, "knee")).toBe("tooHigh");
  });

  it("treats range bounds as inclusive", () => {
    for (const v of [80, 100]) {
      const r = engine.evaluate(features({ right_knee_angle: v }), pose([rule()]), "right", null);
      expect(statusOf(r, "knee")).toBe("pass");
    }
  });

  it("carries the observed value and rule metadata through", () => {
    const r = engine.evaluate(
      features({ right_knee_angle: 95 }),
      pose([rule({ priority: "safety", weight: 3 })]),
      "right",
      null,
    );
    const res = r.results[0]!;
    expect(res.value).toBe(95);
    expect(res.priority).toBe("safety");
    expect(res.weight).toBe(3);
  });

  it("stamps the result with the frame timestamp", () => {
    const r = engine.evaluate(
      features({ right_knee_angle: 95 }, "right", 1234),
      pose([rule()]),
      "right",
      null,
    );
    expect(r.t).toBe(1234);
  });
});

describe("visibility gating", () => {
  it("skips a rule whose joints are below visibility 0.5", () => {
    const r = engine.evaluate(
      features({ right_knee_angle: [60, 0.3] }),
      pose([rule()]),
      "right",
      null,
    );
    expect(statusOf(r, "knee")).toBe("skipped");
    expect(r.results[0]?.value).toBeNull();
  });

  it("judges a rule at exactly 0.5, which is not below the threshold", () => {
    const r = engine.evaluate(
      features({ right_knee_angle: [60, 0.5] }),
      pose([rule()]),
      "right",
      null,
    );
    expect(statusOf(r, "knee")).toBe("tooLow");
  });

  it("skips a rule whose feature is missing from the frame", () => {
    const r = engine.evaluate(features({}), pose([rule()]), "right", null);
    expect(statusOf(r, "knee")).toBe("skipped");
  });

  it("skips a rule whose feature came out NaN", () => {
    const r = engine.evaluate(
      features({ right_knee_angle: Number.NaN }),
      pose([rule()]),
      "right",
      null,
    );
    expect(statusOf(r, "knee")).toBe("skipped");
  });

  it("excludes skipped rules from the score denominator", () => {
    const p = pose([
      rule({ id: "a", feature: "right_knee_angle" }),
      rule({ id: "b", feature: "left_knee_angle" }),
    ]);
    // a passes; b is invisible, so the score is 100, not 50.
    const r = engine.evaluate(
      features({ right_knee_angle: 90, left_knee_angle: [10, 0.1] }),
      p,
      "right",
      null,
    );
    expect(statusOf(r, "b")).toBe("skipped");
    expect(r.score).toBe(100);
  });

  it("reports judged=false and score 0 when every rule is skipped", () => {
    const r = engine.evaluate(
      features({ right_knee_angle: [90, 0.1] }),
      pose([rule()]),
      "right",
      null,
    );
    expect(r.judged).toBe(false);
    expect(r.score).toBe(0);
  });
});

describe("weighted form score", () => {
  it("weights rules by their declared weight", () => {
    const p = pose([
      rule({ id: "heavy", feature: "right_knee_angle", weight: 3 }),
      rule({ id: "light", feature: "left_knee_angle", weight: 1 }),
    ]);
    // heavy passes, light fails => 3 of 4 weight passing.
    const r = engine.evaluate(
      features({ right_knee_angle: 90, left_knee_angle: 10 }),
      p,
      "right",
      null,
    );
    expect(r.score).toBeCloseTo(75, 6);
  });

  it("is 0 when all judged rules fail", () => {
    const r = engine.evaluate(features({ right_knee_angle: 10 }), pose([rule()]), "right", null);
    expect(r.score).toBe(0);
  });

  it("never reports a similarity percentage, only pass share", () => {
    // A value far outside the range scores the same as one just outside:
    // the score is a share of passing rules, not a distance metric.
    const near = engine.evaluate(features({ right_knee_angle: 79 }), pose([rule()]), "right", null);
    const far = engine.evaluate(features({ right_knee_angle: 5 }), pose([rule()]), "right", null);
    expect(near.score).toBe(far.score);
  });
});

describe("hysteresis", () => {
  const h = pose([rule({ hysteresis: 5 })]);

  it("keeps a passing rule passing just outside the range", () => {
    const prev = engine.evaluate(features({ right_knee_angle: 90 }), h, "right", null);
    const next = engine.evaluate(features({ right_knee_angle: 103 }), h, "right", prev);
    expect(statusOf(next, "knee")).toBe("pass");
  });

  it("fails a passing rule once it exceeds the range by more than the deadband", () => {
    const prev = engine.evaluate(features({ right_knee_angle: 90 }), h, "right", null);
    const next = engine.evaluate(features({ right_knee_angle: 106 }), h, "right", prev);
    expect(statusOf(next, "knee")).toBe("tooHigh");
  });

  it("requires a failing rule to come back strictly inside the range", () => {
    const failing = engine.evaluate(features({ right_knee_angle: 120 }), h, "right", null);
    const stillOut = engine.evaluate(features({ right_knee_angle: 103 }), h, "right", failing);
    expect(statusOf(stillOut, "knee")).toBe("tooHigh");
    const backIn = engine.evaluate(features({ right_knee_angle: 99 }), h, "right", stillOut);
    expect(statusOf(backIn, "knee")).toBe("pass");
  });

  it("applies the deadband on the low side too", () => {
    const prev = engine.evaluate(features({ right_knee_angle: 85 }), h, "right", null);
    expect(
      statusOf(engine.evaluate(features({ right_knee_angle: 77 }), h, "right", prev), "knee"),
    ).toBe("pass");
    expect(
      statusOf(engine.evaluate(features({ right_knee_angle: 74 }), h, "right", prev), "knee"),
    ).toBe("tooLow");
  });

  it("does not extend the band after a skipped frame", () => {
    // Coming back from invisible is not the same as having been correct.
    const skipped = engine.evaluate(features({ right_knee_angle: [90, 0.1] }), h, "right", null);
    const next = engine.evaluate(features({ right_knee_angle: 103 }), h, "right", skipped);
    expect(statusOf(next, "knee")).toBe("tooHigh");
  });

  it("stops a value oscillating on the boundary from flapping the status", () => {
    let prev = engine.evaluate(features({ right_knee_angle: 99 }), h, "right", null);
    const seen = new Set<string>();
    for (const v of [101, 99, 102, 100, 103, 98]) {
      prev = engine.evaluate(features({ right_knee_angle: v }), h, "right", prev);
      seen.add(String(statusOf(prev, "knee")));
    }
    expect([...seen]).toEqual(["pass"]);
  });
});

describe("side resolution", () => {
  it("resolves front_ feature names to the active side", () => {
    const p = pose([rule({ feature: "front_knee_angle" })]);
    const asRight = engine.evaluate(
      features({ right_knee_angle: 90, left_knee_angle: 175 }),
      p,
      "right",
      null,
    );
    const asLeft = engine.evaluate(
      features({ right_knee_angle: 90, left_knee_angle: 175 }, "left"),
      p,
      "left",
      null,
    );
    expect(statusOf(asRight, "knee")).toBe("pass");
    expect(statusOf(asLeft, "knee")).toBe("tooHigh");
  });

  it("resolves side-relative highlight joints to concrete landmarks", () => {
    const p = pose([rule({ highlight: ["front_knee", "front_ankle"] })]);
    const r = engine.evaluate(features({ right_knee_angle: 90 }), p, "right", null);
    expect(r.results[0]?.highlight).toEqual(["right_knee", "right_ankle"]);
  });

  it("leaves concrete highlight joints alone", () => {
    const r = engine.evaluate(features({ right_knee_angle: 90 }), pose([rule()]), "right", null);
    expect(r.results[0]?.highlight).toEqual(["right_knee"]);
  });
});

describe("purity", () => {
  it("returns the same result for the same inputs", () => {
    const f = features({ right_knee_angle: 90 });
    const p = pose([rule()]);
    expect(engine.evaluate(f, p, "right", null)).toEqual(engine.evaluate(f, p, "right", null));
  });

  it("does not mutate the features it was given", () => {
    const f = features({ right_knee_angle: 90 });
    const snapshot = clone(f);
    engine.evaluate(f, pose([rule()]), "right", null);
    expect(f).toEqual(snapshot);
  });

  it("does not mutate the previous result", () => {
    const p = pose([rule({ hysteresis: 5 })]);
    const prev = engine.evaluate(features({ right_knee_angle: 90 }), p, "right", null);
    const snapshot = clone(prev);
    engine.evaluate(features({ right_knee_angle: 103 }), p, "right", prev);
    expect(prev).toEqual(snapshot);
  });

  it("keeps results in pose rule order", () => {
    const p = pose([rule({ id: "first" }), rule({ id: "second", feature: "torso_tilt" })]);
    const r = engine.evaluate(features({ right_knee_angle: 90, torso_tilt: 2 }), p, "right", null);
    expect(r.results.map((x) => x.ruleId)).toEqual(["first", "second"]);
  });
});
