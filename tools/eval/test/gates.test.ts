import { describe, expect, it } from "vitest";
import { MIN_PERSONS_FOR_GATES, gradeRule, overallVerdict } from "../src/gates.ts";
import type { RuleMetrics } from "../src/metrics.ts";
import type { Priority } from "@asan/core";

/** A metrics record with plenty of judged time, so only the values under test matter. */
function metrics(over: Partial<RuleMetrics> & { priority: Priority }): RuleMetrics {
  return {
    ruleId: "r",
    tpMs: 30000,
    fpMs: 0,
    fnMs: 0,
    tnMs: 30000,
    falseAlarmEvents: 0,
    correctMs: 60000,
    mistakesTotal: 4,
    mistakesDetected: 4,
    unjudgeableMs: 0,
    precision: 1,
    recall: 1,
    falseAlarmsPerMinute: 0,
    eventRecall: 1,
    ...over,
  };
}

const ENOUGH = MIN_PERSONS_FOR_GATES;

describe("safety gate", () => {
  it("passes at 80% precision and 70% recall", () => {
    const g = gradeRule(metrics({ priority: "safety", precision: 0.8, recall: 0.7 }), ENOUGH);
    expect(g.verdict).toBe("pass");
  });

  it("fails just below the precision floor", () => {
    const g = gradeRule(metrics({ priority: "safety", precision: 0.79, recall: 0.9 }), ENOUGH);
    expect(g.verdict).toBe("fail");
    expect(g.reasons.join(" ")).toMatch(/precision/);
  });

  it("fails just below the recall floor", () => {
    const g = gradeRule(metrics({ priority: "safety", precision: 0.95, recall: 0.69 }), ENOUGH);
    expect(g.verdict).toBe("fail");
    expect(g.reasons.join(" ")).toMatch(/recall/);
  });
});

describe("alignment gate", () => {
  it("passes at 75% precision and 60% recall", () => {
    expect(
      gradeRule(metrics({ priority: "alignment", precision: 0.75, recall: 0.6 }), ENOUGH).verdict,
    ).toBe("pass");
  });

  it("fails below them", () => {
    expect(
      gradeRule(metrics({ priority: "alignment", precision: 0.74, recall: 0.6 }), ENOUGH).verdict,
    ).toBe("fail");
  });

  it("is stricter for safety than for alignment at the same numbers", () => {
    const values = { precision: 0.76, recall: 0.65 };
    expect(gradeRule(metrics({ priority: "alignment", ...values }), ENOUGH).verdict).toBe("pass");
    expect(gradeRule(metrics({ priority: "safety", ...values }), ENOUGH).verdict).toBe("fail");
  });
});

describe("refinement rules", () => {
  it("have no accuracy gate", () => {
    const g = gradeRule(metrics({ priority: "refinement", precision: 0.1, recall: 0.1 }), ENOUGH);
    expect(g.verdict).toBe("pass");
  });

  it("still share the false-alarm budget", () => {
    const g = gradeRule(metrics({ priority: "refinement", falseAlarmsPerMinute: 0.8 }), ENOUGH);
    expect(g.verdict).toBe("fail");
  });
});

describe("false-alarm budget", () => {
  it("passes at exactly 0.5 per minute", () => {
    expect(
      gradeRule(metrics({ priority: "safety", falseAlarmsPerMinute: 0.5 }), ENOUGH).verdict,
    ).toBe("pass");
  });

  it("fails above it", () => {
    const g = gradeRule(metrics({ priority: "safety", falseAlarmsPerMinute: 0.51 }), ENOUGH);
    expect(g.verdict).toBe("fail");
    expect(g.reasons.join(" ")).toMatch(/false alarms/);
  });

  it("fails even on a thin corpus, since a nagging cue needs no statistics", () => {
    const g = gradeRule(
      metrics({
        priority: "safety",
        falseAlarmsPerMinute: 2,
        precision: undefined,
        recall: undefined,
      }),
      1,
    );
    expect(g.verdict).toBe("fail");
  });
});

describe("insufficient data is never a pass", () => {
  it("reports thin when too few people are in the corpus", () => {
    const g = gradeRule(metrics({ priority: "safety" }), 1);
    expect(g.verdict).toBe("insufficient");
    expect(g.reasons.join(" ")).toMatch(/person/);
  });

  it("reports thin when a rule has too little judged time", () => {
    const g = gradeRule(
      metrics({ priority: "safety", tpMs: 1000, fpMs: 0, fnMs: 0, tnMs: 1000 }),
      ENOUGH,
    );
    expect(g.verdict).toBe("insufficient");
    expect(g.reasons.join(" ")).toMatch(/judged/);
  });

  it("reports thin when no mistake was ever labelled for the rule", () => {
    const g = gradeRule(
      metrics({ priority: "safety", recall: undefined, mistakesTotal: 0, mistakesDetected: 0 }),
      ENOUGH,
    );
    expect(g.verdict).toBe("insufficient");
  });

  it("reports thin when the rule never fired", () => {
    const g = gradeRule(metrics({ priority: "safety", precision: undefined }), ENOUGH);
    expect(g.verdict).toBe("insufficient");
  });

  it("does not let a thin corpus produce a green precision or recall verdict", () => {
    const g = gradeRule(metrics({ priority: "safety", precision: 0.2, recall: 0.2 }), 1);
    expect(g.verdict).not.toBe("pass");
  });
});

describe("overallVerdict", () => {
  const at = (verdict: "pass" | "fail" | "insufficient") => ({
    ruleId: "x",
    priority: "safety" as Priority,
    verdict,
    reasons: [],
  });

  it("passes only when every rule passes", () => {
    expect(overallVerdict([at("pass"), at("pass")])).toBe("pass");
  });

  it("fails if any rule fails, even alongside thin ones", () => {
    expect(overallVerdict([at("pass"), at("insufficient"), at("fail")])).toBe("fail");
  });

  it("is insufficient if any rule is thin and none fail", () => {
    expect(overallVerdict([at("pass"), at("insufficient")])).toBe("insufficient");
  });

  it("is insufficient for an empty corpus rather than vacuously passing", () => {
    expect(overallVerdict([])).toBe("insufficient");
  });
});
