import { describe, expect, it } from "vitest";
import { MetricsAccumulator, finalize } from "../src/metrics.ts";
import type { ReplayFrame, ReplayResult } from "../src/replay.ts";
import type { Mistake } from "../src/schema.ts";
import { mountain } from "@asan/poses";
import type { RuleStatus } from "@asan/core";

const RULE = "torso-upright";

/** Build a replay of evenly spaced frames from a compact status string. */
function replayOf(statuses: Array<RuleStatus | "unsettled">, stepMs = 100): ReplayResult {
  const frames: ReplayFrame[] = statuses.map((s, i) => ({
    t: i * stepMs,
    settled: s !== "unsettled",
    statuses: s === "unsettled" ? {} : ({ [RULE]: s } as Record<string, RuleStatus>),
    score: s === "pass" ? 100 : 0,
    judged: s !== "unsettled" && s !== "skipped",
  }));
  const last = frames[frames.length - 1]?.t ?? 0;
  return { frames, durationMs: last, settledMs: last };
}

function tally(statuses: Array<RuleStatus | "unsettled">, mistakes: Mistake[] = [], stepMs = 100) {
  const acc = new MetricsAccumulator();
  acc.add(replayOf(statuses, stepMs), mountain, mistakes);
  return acc.results().find((m) => m.ruleId === RULE)!;
}

const mistake = (start: number, end: number): Mistake => ({ ruleId: RULE, start, end });

describe("time accounting", () => {
  it("counts a correctly quiet rule as true negative time", () => {
    const m = tally(["pass", "pass", "pass", "pass"]);
    // Trailing attribution: 3 intervals of 100 ms across 4 frames.
    expect(m.tnMs).toBe(300);
    expect(m.tpMs).toBe(0);
    expect(m.fpMs).toBe(0);
  });

  it("counts a detected mistake as true positive time", () => {
    const m = tally(["pass", "tooHigh", "tooHigh", "pass"], [mistake(100, 200)]);
    expect(m.tpMs).toBe(200);
  });

  it("counts a missed mistake as false negative time", () => {
    const m = tally(["pass", "pass", "pass", "pass"], [mistake(100, 300)]);
    expect(m.fnMs).toBe(300);
    expect(m.recall).toBe(0);
  });

  it("counts a fault reported on correct form as false positive time", () => {
    const m = tally(["pass", "tooHigh", "pass", "pass"]);
    expect(m.fpMs).toBe(100);
    expect(m.precision).toBe(0);
  });

  it("weights by elapsed time, so frame rate does not skew results", () => {
    const fast = tally(["pass", "tooHigh", "tooHigh", "pass"], [mistake(50, 250)], 50);
    const slow = tally(["pass", "tooHigh", "tooHigh", "pass"], [mistake(100, 500)], 100);
    expect(fast.recall).toBeCloseTo(slow.recall ?? Number.NaN, 6);
  });
});

describe("excluding what could not be judged", () => {
  // Each frame's verdict covers the interval that just elapsed (trailing
  // attribution, matching FormScore in core), so the interval spanning a
  // transition belongs to the frame that ends it.
  it("excludes unsettled frames", () => {
    const m = tally(["unsettled", "unsettled", "pass", "pass", "pass"]);
    expect(m.unjudgeableMs).toBe(100);
    expect(m.tnMs).toBe(300);
  });

  it("excludes frames where the rule was skipped for low visibility", () => {
    const m = tally(["skipped", "skipped", "skipped", "pass"]);
    expect(m.unjudgeableMs).toBe(200);
    expect(m.tnMs).toBe(100);
  });

  it("does not blame the engine for a mistake it could not see", () => {
    const m = tally(["unsettled", "unsettled", "unsettled"], [mistake(0, 200)]);
    expect(m.fnMs).toBe(0);
    expect(m.recall).toBeUndefined();
  });
});

describe("undefined rather than misleading zeros", () => {
  it("leaves precision undefined when the rule never fired", () => {
    expect(tally(["pass", "pass"]).precision).toBeUndefined();
  });

  it("leaves recall undefined when nothing was labelled", () => {
    expect(tally(["pass", "tooHigh"]).recall).toBeUndefined();
  });

  it("leaves event recall undefined when there are no labelled mistakes", () => {
    expect(tally(["pass", "pass"]).eventRecall).toBeUndefined();
  });
});

describe("false alarms are counted as events, not frames", () => {
  it("counts one long spurious run as a single false alarm", () => {
    const m = tally(["pass", "tooHigh", "tooHigh", "tooHigh", "tooHigh", "pass"]);
    expect(m.falseAlarmEvents).toBe(1);
  });

  it("counts two separated runs as two false alarms", () => {
    const m = tally(["pass", "tooHigh", "pass", "pass", "tooHigh", "pass"]);
    expect(m.falseAlarmEvents).toBe(2);
  });

  it("does not count a correct detection as a false alarm", () => {
    const m = tally(["pass", "tooHigh", "tooHigh", "pass"], [mistake(100, 200)]);
    expect(m.falseAlarmEvents).toBe(0);
  });

  it("does not stitch two runs across an unjudgeable gap", () => {
    const m = tally(["tooHigh", "unsettled", "tooHigh"]);
    expect(m.falseAlarmEvents).toBe(2);
  });

  it("expresses the rate per minute of correct-form time", () => {
    // 60 s of correct form with one spurious run => 1.0 per minute.
    const statuses: Array<RuleStatus | "unsettled"> = Array.from({ length: 61 }, (_, i) =>
      i === 10 ? "tooHigh" : "pass",
    );
    const m = tally(statuses, [], 1000);
    expect(m.correctMs).toBe(60000);
    expect(m.falseAlarmsPerMinute).toBeCloseTo(1, 6);
  });

  it("is zero when there is no correct-form time to measure against", () => {
    expect(
      finalize({
        ruleId: "r",
        priority: "safety",
        tpMs: 0,
        fpMs: 0,
        fnMs: 0,
        tnMs: 0,
        falseAlarmEvents: 0,
        correctMs: 0,
        mistakesTotal: 0,
        mistakesDetected: 0,
        unjudgeableMs: 0,
      }).falseAlarmsPerMinute,
    ).toBe(0);
  });
});

describe("event-level mistake detection", () => {
  it("counts a mistake as detected if any frame of it fired", () => {
    const m = tally(["pass", "pass", "tooHigh", "pass"], [mistake(100, 300)]);
    expect(m.mistakesDetected).toBe(1);
    expect(m.eventRecall).toBe(1);
  });

  it("counts a wholly missed mistake as undetected", () => {
    const m = tally(["pass", "pass", "pass", "pass"], [mistake(100, 300)]);
    expect(m.mistakesDetected).toBe(0);
    expect(m.eventRecall).toBe(0);
  });

  it("reports partial detection across several mistakes", () => {
    const m = tally(
      ["pass", "tooHigh", "pass", "pass", "pass", "pass"],
      [mistake(100, 150), mistake(400, 500)],
    );
    expect(m.eventRecall).toBeCloseTo(0.5, 6);
  });
});

describe("accumulating across recordings", () => {
  it("sums tallies from several recordings", () => {
    const acc = new MetricsAccumulator();
    acc.add(replayOf(["pass", "pass", "pass"]), mountain, []);
    acc.add(replayOf(["pass", "pass", "pass"]), mountain, []);
    expect(acc.results().find((m) => m.ruleId === RULE)?.tnMs).toBe(400);
  });

  it("reports a tally for every rule in the pose, fired or not", () => {
    const acc = new MetricsAccumulator();
    acc.add(replayOf(["pass", "pass"]), mountain, []);
    expect(
      acc
        .results()
        .map((m) => m.ruleId)
        .sort(),
    ).toEqual(mountain.rules.map((r) => r.id).sort());
  });
});
