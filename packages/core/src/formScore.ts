/**
 * Form score and hold timer.
 *
 * The score is a weighted share of passing rules — never a similarity
 * percentage. Over a hold it is averaged by elapsed time rather than by frame
 * count, so adaptive frame skipping cannot bias it.
 *
 * The hold timer advances only while form is correct, and never across a gap
 * where the body could not be judged.
 */
import type { EvalResult } from "./types.ts";

/** True when the pose was judged and no rule is currently failing. */
export function isFormCorrect(result: EvalResult): boolean {
  if (!result.judged) return false;
  return !result.results.some((r) => r.status === "tooLow" || r.status === "tooHigh");
}

interface RuleTally {
  passMs: number;
  judgedMs: number;
}

export class FormScore {
  private lastScore = 0;
  private prevT: number | null = null;
  private prev: EvalResult | null = null;
  private weightedSum = 0;
  private elapsedMs = 0;
  private scoreSum = 0;
  private frames = 0;
  private heldMs = 0;
  private readonly perRule = new Map<string, RuleTally>();

  /** Feed one evaluated frame. Only call this while the pose is settled. */
  update(result: EvalResult): void {
    if (!result.judged) {
      // Break the interval: time we could not judge is not part of the hold.
      this.prevT = null;
      this.prev = null;
      return;
    }

    this.lastScore = result.score;
    this.scoreSum += result.score;
    this.frames++;

    // Trailing attribution: this frame's verdict covers the interval that just
    // elapsed. The first frame of a hold covers no interval yet.
    const dt = this.prevT === null ? 0 : result.t - this.prevT;
    if (dt > 0) {
      this.weightedSum += result.score * dt;
      this.elapsedMs += dt;
      if (isFormCorrect(result)) this.heldMs += dt;
      for (const r of result.results) {
        if (r.status === "skipped") continue;
        const tally = this.perRule.get(r.ruleId) ?? { passMs: 0, judgedMs: 0 };
        tally.judgedMs += dt;
        if (r.status === "pass") tally.passMs += dt;
        this.perRule.set(r.ruleId, tally);
      }
    }

    this.prevT = result.t;
    this.prev = result;
  }

  /** The latest frame's score, 0..100. */
  get instant(): number {
    return this.lastScore;
  }

  /**
   * Time-weighted mean score across the hold, 0..100. Falls back to the mean of
   * the frames seen until enough time has elapsed to weight by.
   */
  get average(): number {
    if (this.elapsedMs > 0) return this.weightedSum / this.elapsedMs;
    return this.frames > 0 ? this.scoreSum / this.frames : 0;
  }

  /** Milliseconds of the hold spent with correct form. */
  get holdMs(): number {
    return this.heldMs;
  }

  get holdSeconds(): number {
    return this.heldMs / 1000;
  }

  /** Whether the most recent judged frame had correct form. */
  get correct(): boolean {
    return this.prev !== null && isFormCorrect(this.prev);
  }

  /** Share of judged time each rule spent passing, 0..1, keyed by rule id. */
  rulePassShare(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [ruleId, tally] of this.perRule) {
      if (tally.judgedMs > 0) out[ruleId] = tally.passMs / tally.judgedMs;
    }
    return out;
  }

  reset(): void {
    this.lastScore = 0;
    this.prevT = null;
    this.prev = null;
    this.weightedSum = 0;
    this.elapsedMs = 0;
    this.scoreSum = 0;
    this.frames = 0;
    this.heldMs = 0;
    this.perRule.clear();
  }
}
