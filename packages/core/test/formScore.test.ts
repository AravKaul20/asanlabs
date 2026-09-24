import { describe, expect, it } from "vitest";
import { FormScore, isFormCorrect } from "../src/formScore.ts";
import type { EvalResult, RuleResult, RuleStatus } from "../src/types.ts";

const res = (ruleId: string, status: RuleStatus, weight = 1): RuleResult => ({
  ruleId,
  status,
  value: status === "skipped" ? null : 1,
  weight,
  priority: "alignment",
  highlight: [],
});

/** Build an EvalResult with the score implied by its rule statuses. */
function evalAt(t: number, results: RuleResult[]): EvalResult {
  let passing = 0;
  let judged = 0;
  for (const r of results) {
    if (r.status === "skipped") continue;
    judged += r.weight;
    if (r.status === "pass") passing += r.weight;
  }
  return {
    t,
    results,
    score: judged > 0 ? (passing / judged) * 100 : 0,
    judged: judged > 0,
  };
}

const pass = (t: number) => evalAt(t, [res("a", "pass"), res("b", "pass")]);
const half = (t: number) => evalAt(t, [res("a", "pass"), res("b", "tooHigh")]);
const fail = (t: number) => evalAt(t, [res("a", "tooHigh"), res("b", "tooHigh")]);
const blind = (t: number) => evalAt(t, [res("a", "skipped"), res("b", "skipped")]);

describe("isFormCorrect", () => {
  it("is true when no rule is failing", () => {
    expect(isFormCorrect(pass(0))).toBe(true);
  });

  it("is false when any rule fails", () => {
    expect(isFormCorrect(half(0))).toBe(false);
  });

  it("is false when nothing could be judged", () => {
    expect(isFormCorrect(blind(0))).toBe(false);
  });

  it("tolerates skipped rules alongside passing ones", () => {
    expect(isFormCorrect(evalAt(0, [res("a", "pass"), res("b", "skipped")]))).toBe(true);
  });
});

describe("FormScore instant value", () => {
  it("reports the latest frame's score", () => {
    const s = new FormScore();
    s.update(half(0));
    expect(s.instant).toBe(50);
  });

  it("starts at zero", () => {
    expect(new FormScore().instant).toBe(0);
  });

  it("weights rules as the engine did", () => {
    const s = new FormScore();
    s.update(evalAt(0, [res("a", "pass", 3), res("b", "tooHigh", 1)]));
    expect(s.instant).toBe(75);
  });
});

describe("FormScore average over the hold", () => {
  it("equals the single frame's score when only one frame was seen", () => {
    const s = new FormScore();
    s.update(half(0));
    expect(s.average).toBe(50);
  });

  it("stays 100 through a clean hold", () => {
    const s = new FormScore();
    for (let t = 0; t <= 3000; t += 66) s.update(pass(t));
    expect(s.average).toBeCloseTo(100, 6);
  });

  it("averages to 50 over equal time at 100 and at 0", () => {
    const s = new FormScore();
    for (let t = 0; t <= 1000; t += 100) s.update(pass(t));
    for (let t = 1100; t <= 2000; t += 100) s.update(fail(t));
    expect(s.average).toBeCloseTo(50, 6);
  });

  it("weights by elapsed time, not by frame count", () => {
    // One frame at 100 covering 900 ms, then one at 0 covering 100 ms.
    const s = new FormScore();
    s.update(pass(0));
    s.update(pass(900));
    s.update(fail(1000));
    expect(s.average).toBeCloseTo(90, 6);
  });

  it("ignores frames it could not judge", () => {
    const s = new FormScore();
    s.update(pass(0));
    s.update(pass(500));
    s.update(blind(600));
    s.update(blind(700));
    expect(s.average).toBeCloseTo(100, 6);
  });

  it("does not credit a gap where tracking was lost", () => {
    const s = new FormScore();
    s.update(pass(0));
    s.update(pass(500));
    s.update(blind(600));
    // Five seconds of nothing, then a failing frame: the gap must not count.
    s.update(fail(5600));
    s.update(fail(5700));
    expect(s.average).toBeGreaterThan(70);
  });
});

describe("hold timer", () => {
  it("counts only while form is correct", () => {
    const s = new FormScore();
    for (let t = 0; t <= 1000; t += 100) s.update(pass(t));
    expect(s.holdMs).toBe(1000);
  });

  it("does not advance while a rule is failing", () => {
    const s = new FormScore();
    for (let t = 0; t <= 1000; t += 100) s.update(pass(t));
    for (let t = 1100; t <= 2000; t += 100) s.update(half(t));
    expect(s.holdMs).toBe(1000);
  });

  it("resumes once form comes back", () => {
    const s = new FormScore();
    for (let t = 0; t <= 500; t += 100) s.update(pass(t));
    for (let t = 600; t <= 1000; t += 100) s.update(fail(t));
    for (let t = 1100; t <= 1600; t += 100) s.update(pass(t));
    expect(s.holdMs).toBe(1100);
  });

  it("does not count a tracking gap as held time", () => {
    const s = new FormScore();
    s.update(pass(0));
    s.update(pass(500));
    s.update(blind(600));
    s.update(pass(9000));
    s.update(pass(9100));
    expect(s.holdMs).toBe(600);
  });

  it("exposes seconds for display", () => {
    const s = new FormScore();
    for (let t = 0; t <= 2500; t += 500) s.update(pass(t));
    expect(s.holdSeconds).toBeCloseTo(2.5, 6);
  });

  it("stays at zero through a hold that is never correct", () => {
    const s = new FormScore();
    for (let t = 0; t <= 2000; t += 100) s.update(fail(t));
    expect(s.holdMs).toBe(0);
  });
});

describe("FormScore reset", () => {
  it("clears the average and the hold timer", () => {
    const s = new FormScore();
    for (let t = 0; t <= 1000; t += 100) s.update(pass(t));
    s.reset();
    expect(s.holdMs).toBe(0);
    expect(s.instant).toBe(0);
    s.update(half(5000));
    expect(s.average).toBe(50);
  });
});

describe("per-rule pass share", () => {
  it("reports how much of the hold each rule was passing", () => {
    const s = new FormScore();
    for (let t = 0; t <= 1000; t += 100) s.update(pass(t));
    for (let t = 1100; t <= 2000; t += 100) s.update(half(t));
    const share = s.rulePassShare();
    expect(share["a"]).toBeCloseTo(1, 6);
    expect(share["b"]).toBeCloseTo(0.5, 6);
  });

  it("ignores time a rule was skipped", () => {
    const s = new FormScore();
    for (let t = 0; t <= 1000; t += 100) {
      s.update(evalAt(t, [res("a", "pass"), res("b", "skipped")]));
    }
    expect(s.rulePassShare()["b"]).toBeUndefined();
  });
});
