/**
 * Scoring the engine against labelled recordings.
 *
 * Two deliberate choices:
 *
 * 1. Everything is weighted by elapsed time, not frame count. The live pipeline
 *    drops to every other frame on slow devices, and frame-counting would let
 *    frame rate skew the numbers.
 *
 * 2. False alarms are counted as *events*, not frames. A 15 fps stream produces
 *    900 frames a minute, so a frame-based rate could never be read against a
 *    "0.5 per minute" budget. One false alarm is one contiguous run of a rule
 *    reporting a fault while the labels say the form was correct.
 *
 * Frames the engine could not judge — not settled, or a rule skipped for low
 * visibility — are excluded and reported separately. Holding the engine to
 * account for joints it could not see would measure the camera, not the rules.
 */
import type { Priority, PoseDefinition, RuleStatus } from "@asan/core";
import type { Mistake } from "./schema.ts";
import type { ReplayFrame, ReplayResult } from "./replay.ts";

export interface RuleTally {
  ruleId: string;
  priority: Priority;
  tpMs: number;
  fpMs: number;
  fnMs: number;
  tnMs: number;
  /** Contiguous runs of a fault reported while the labels say form was correct. */
  falseAlarmEvents: number;
  /** Judgeable time the labels call correct, in ms: the false-alarm denominator. */
  correctMs: number;
  /** Labelled mistakes, and how many were detected at all. */
  mistakesTotal: number;
  mistakesDetected: number;
  /** Time excluded because the rule could not be judged, in ms. */
  unjudgeableMs: number;
}

export interface RuleMetrics extends RuleTally {
  /** Undefined when the rule never reported a fault. */
  precision: number | undefined;
  /** Undefined when the corpus contains no labelled mistake for the rule. */
  recall: number | undefined;
  falseAlarmsPerMinute: number;
  /** Share of labelled mistakes the rule caught at all, 0..1. */
  eventRecall: number | undefined;
}

const emptyTally = (ruleId: string, priority: Priority): RuleTally => ({
  ruleId,
  priority,
  tpMs: 0,
  fpMs: 0,
  fnMs: 0,
  tnMs: 0,
  falseAlarmEvents: 0,
  correctMs: 0,
  mistakesTotal: 0,
  mistakesDetected: 0,
  unjudgeableMs: 0,
});

const isFault = (status: RuleStatus | undefined): boolean =>
  status === "tooLow" || status === "tooHigh";

const inAnyMistake = (t: number, mistakes: readonly Mistake[]): boolean =>
  mistakes.some((m) => t >= m.start && t <= m.end);

/** Accumulates tallies across every recording in the corpus. */
export class MetricsAccumulator {
  private readonly tallies = new Map<string, RuleTally>();

  /** Fold one replayed recording, with its labels, into the running tallies. */
  add(replay: ReplayResult, pose: PoseDefinition, mistakes: readonly Mistake[]): void {
    for (const rule of pose.rules) {
      const tally = this.tallies.get(rule.id) ?? emptyTally(rule.id, rule.priority);
      const forRule = mistakes.filter((m) => m.ruleId === rule.id);

      this.foldRule(tally, replay.frames, rule.id, forRule);

      tally.mistakesTotal += forRule.length;
      for (const mistake of forRule) {
        const detected = replay.frames.some(
          (f) =>
            f.t >= mistake.start && f.t <= mistake.end && f.settled && isFault(f.statuses[rule.id]),
        );
        if (detected) tally.mistakesDetected++;
      }

      this.tallies.set(rule.id, tally);
    }
  }

  private foldRule(
    tally: RuleTally,
    frames: readonly ReplayFrame[],
    ruleId: string,
    mistakes: readonly Mistake[],
  ): void {
    let prevT: number | null = null;
    let inFalseAlarm = false;

    for (const frame of frames) {
      const dt = prevT === null ? 0 : frame.t - prevT;
      prevT = frame.t;

      const status = frame.statuses[ruleId];
      const judgeable = frame.settled && status !== undefined && status !== "skipped";
      if (!judgeable) {
        tally.unjudgeableMs += dt;
        // A gap in judging ends any run in progress.
        inFalseAlarm = false;
        continue;
      }

      const predicted = isFault(status);
      const actual = inAnyMistake(frame.t, mistakes);

      if (predicted && actual) tally.tpMs += dt;
      else if (predicted && !actual) tally.fpMs += dt;
      else if (!predicted && actual) tally.fnMs += dt;
      else tally.tnMs += dt;

      if (!actual) tally.correctMs += dt;

      // Count the onset of each spurious correction, not every frame of it.
      if (predicted && !actual) {
        if (!inFalseAlarm) {
          tally.falseAlarmEvents++;
          inFalseAlarm = true;
        }
      } else {
        inFalseAlarm = false;
      }
    }
  }

  results(): RuleMetrics[] {
    return [...this.tallies.values()].map(finalize);
  }
}

export function finalize(tally: RuleTally): RuleMetrics {
  const predictedMs = tally.tpMs + tally.fpMs;
  const actualMs = tally.tpMs + tally.fnMs;
  const correctMinutes = tally.correctMs / 60000;
  return {
    ...tally,
    precision: predictedMs > 0 ? tally.tpMs / predictedMs : undefined,
    recall: actualMs > 0 ? tally.tpMs / actualMs : undefined,
    falseAlarmsPerMinute: correctMinutes > 0 ? tally.falseAlarmEvents / correctMinutes : 0,
    eventRecall: tally.mistakesTotal > 0 ? tally.mistakesDetected / tally.mistakesTotal : undefined,
  };
}
