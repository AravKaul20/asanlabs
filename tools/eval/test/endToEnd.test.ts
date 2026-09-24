/**
 * End-to-end over the committed synthetic corpus in data/eval.
 *
 * These fixtures test the harness, not the rules: ground truth was derived from
 * the poses' own declared ranges. What they prove is that a labelled recording
 * replays through the engine and comes out as sensible metrics.
 */
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../src/corpus.ts";
import { replay } from "../src/replay.ts";
import { MetricsAccumulator } from "../src/metrics.ts";

const DIR = new URL("../../../data/eval", import.meta.url).pathname;

const corpus = await loadCorpus(DIR);

describe("the committed synthetic corpus", () => {
  it("loads cleanly", () => {
    expect(corpus.warnings).toEqual([]);
    expect(corpus.entries).toHaveLength(2);
  });

  it("covers both poses", () => {
    expect(corpus.entries.map((e) => e.pose.id).sort()).toEqual(["mountain", "warrior-ii"]);
  });

  it("uses a different person per recording, so a split is possible", () => {
    const people = new Set(corpus.entries.map((e) => e.label.person));
    expect(people.size).toBe(2);
  });

  it("labels at least one mistake in each recording", () => {
    for (const entry of corpus.entries) {
      expect(entry.label.mistakes.length, entry.name).toBeGreaterThan(0);
    }
  });
});

describe("replaying the corpus", () => {
  it("settles during each recording, so rules are actually judged", () => {
    for (const entry of corpus.entries) {
      const result = replay(entry.recording, entry.pose, entry.label.side);
      expect(result.settledMs, entry.name).toBeGreaterThan(3000);
    }
  });

  it("is deterministic: two replays agree exactly", () => {
    const entry = corpus.entries[0]!;
    const a = replay(entry.recording, entry.pose, entry.label.side);
    const b = replay(entry.recording, entry.pose, entry.label.side);
    expect(a).toEqual(b);
  });

  it("detects every labelled mistake", () => {
    for (const entry of corpus.entries) {
      const result = replay(entry.recording, entry.pose, entry.label.side);
      const accumulator = new MetricsAccumulator();
      accumulator.add(result, entry.pose, entry.label.mistakes);
      for (const metrics of accumulator.results()) {
        if (metrics.mistakesTotal === 0) continue;
        expect(metrics.mistakesDetected, `${entry.name}/${metrics.ruleId}`).toBe(
          metrics.mistakesTotal,
        );
      }
    }
  });

  it("raises no false alarms on the synthetic clips", () => {
    for (const entry of corpus.entries) {
      const result = replay(entry.recording, entry.pose, entry.label.side);
      const accumulator = new MetricsAccumulator();
      accumulator.add(result, entry.pose, entry.label.mistakes);
      for (const metrics of accumulator.results()) {
        expect(metrics.falseAlarmsPerMinute, `${entry.name}/${metrics.ruleId}`).toBeLessThanOrEqual(
          0.5,
        );
      }
    }
  });

  it("reaches the safety rule in each pose, proving it is not dead code", () => {
    // Regression guard: Mountain's settle band once capped torso tilt below the
    // point its safety rule fired, so the rule could never trigger.
    for (const entry of corpus.entries) {
      const safetyRules = entry.pose.rules.filter((r) => r.priority === "safety");
      const labelled = safetyRules.filter((r) =>
        entry.label.mistakes.some((m) => m.ruleId === r.id),
      );
      if (labelled.length === 0) continue;
      const result = replay(entry.recording, entry.pose, entry.label.side);
      for (const rule of labelled) {
        const fired = result.frames.some(
          (f) => f.statuses[rule.id] === "tooLow" || f.statuses[rule.id] === "tooHigh",
        );
        expect(fired, `${entry.name}/${rule.id}`).toBe(true);
      }
    }
  });
});
