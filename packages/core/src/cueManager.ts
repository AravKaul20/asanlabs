/**
 * The cue manager turns rule results into speech.
 *
 * It implements the feedback policy directly:
 *   - exactly one active cue at a time, identical on voice and screen
 *   - safety beats alignment beats refinement
 *   - at most one new cue per 3.5 s
 *   - the same cue is not repeated within 8 s
 *   - a fix is confirmed with "Good."
 *   - when unsure, stay silent
 *
 * Time is injected. Nothing here reads a clock.
 */
import type { PoseDefinition, PoseRule } from "./pose/schema.ts";
import type { Cue, CueEvent, Priority, RuleResult } from "./types.ts";

export interface CueManagerConfig {
  /** Minimum gap between two new cues, in ms. */
  newCueIntervalMs?: number;
  /** Minimum gap before the same cue may be said again, in ms. */
  repeatIntervalMs?: number;
  /** What to say when a cued fault is corrected. */
  confirmation?: string;
}

const DEFAULTS = {
  newCueIntervalMs: 3500,
  repeatIntervalMs: 8000,
  confirmation: "Good.",
} as const;

const PRIORITY_RANK: Record<Priority, number> = { safety: 0, alignment: 1, refinement: 2 };

type Direction = "tooLow" | "tooHigh";

interface Candidate {
  rule: PoseRule;
  direction: Direction;
  order: number;
  highlight: string[];
}

export class CueManager {
  private readonly newCueIntervalMs: number;
  private readonly repeatIntervalMs: number;
  private readonly confirmation: string;

  private activeCue: (Cue & { direction: Direction }) | null = null;
  private lastCueAt: number | null = null;
  /** Last time each cue (rule + direction) was spoken, for the repeat guard. */
  private readonly lastSpokenAt = new Map<string, number>();
  /** Rotation index per cue, so repeated corrections vary in wording. */
  private readonly phrasing = new Map<string, number>();

  constructor(config: CueManagerConfig = {}) {
    this.newCueIntervalMs = config.newCueIntervalMs ?? DEFAULTS.newCueIntervalMs;
    this.repeatIntervalMs = config.repeatIntervalMs ?? DEFAULTS.repeatIntervalMs;
    this.confirmation = config.confirmation ?? DEFAULTS.confirmation;
  }

  get active(): Cue | null {
    if (!this.activeCue) return null;
    const { direction: _direction, ...cue } = this.activeCue;
    return cue;
  }

  update(results: readonly RuleResult[], pose: PoseDefinition, now: number): CueEvent[] {
    const events: CueEvent[] = [];
    const byId = new Map(results.map((r) => [r.ruleId, r]));

    // 1. Resolve what happened to the cue we are currently on.
    const active = this.activeCue;
    if (active) {
      const current = byId.get(active.ruleId);
      if (!current || current.status === "skipped") {
        // Tracking was lost, not fixed. Drop the cue without claiming success.
        this.activeCue = null;
        events.push({ type: "clear", t: now });
      } else if (current.status === "pass") {
        this.activeCue = null;
        events.push({ type: "fixed", t: now, ruleId: active.ruleId, text: this.confirmation });
      }
    }

    // 2. Say the most deserving failing rule we are allowed to speak. If the best
    // candidate is inside its repeat guard we fall through to the next one:
    // a muted cue should not silence a different, still-useful correction.
    const stillActive = this.activeCue;
    for (const candidate of this.candidates(results, pose)) {
      const preempts =
        stillActive === null ||
        PRIORITY_RANK[candidate.rule.priority] < PRIORITY_RANK[stillActive.priority];
      if (!preempts) break;
      if (!this.mayspeak(candidate, now)) continue;
      const cue = this.buildCue(candidate, now);
      this.activeCue = cue;
      this.lastCueAt = now;
      events.push({ type: "cue", t: now, cue: { ...cue } });
      break;
    }

    return events;
  }

  reset(): void {
    this.activeCue = null;
    this.lastCueAt = null;
    this.lastSpokenAt.clear();
    this.phrasing.clear();
  }

  /** Failing rules that have wording for their direction, best first. */
  private candidates(results: readonly RuleResult[], pose: PoseDefinition): Candidate[] {
    const order = new Map(pose.rules.map((r, i) => [r.id, i]));
    const out: Candidate[] = [];

    for (const result of results) {
      if (result.status !== "tooLow" && result.status !== "tooHigh") continue;
      const index = order.get(result.ruleId);
      if (index === undefined) continue; // not a rule of this pose
      const rule = pose.rules[index];
      if (!rule) continue;
      const direction: Direction = result.status;
      // No wording for this direction means nothing to say: stay silent.
      if (!rule.cues[direction]?.length) continue;
      out.push({ rule, direction, order: index, highlight: result.highlight });
    }

    return out.sort(
      (a, b) =>
        PRIORITY_RANK[a.rule.priority] - PRIORITY_RANK[b.rule.priority] || a.order - b.order,
    );
  }

  private mayspeak(candidate: Candidate, now: number): boolean {
    if (this.lastCueAt !== null && now - this.lastCueAt < this.newCueIntervalMs) return false;
    const last = this.lastSpokenAt.get(cueKey(candidate));
    return last === undefined || now - last >= this.repeatIntervalMs;
  }

  private buildCue(candidate: Candidate, now: number): Cue & { direction: Direction } {
    const key = cueKey(candidate);
    const options = candidate.rule.cues[candidate.direction] ?? [];
    const index = this.phrasing.get(key) ?? 0;
    this.phrasing.set(key, (index + 1) % Math.max(options.length, 1));
    this.lastSpokenAt.set(key, now);
    return {
      ruleId: candidate.rule.id,
      text: options[index % options.length] ?? "",
      priority: candidate.rule.priority,
      highlight: candidate.highlight,
      direction: candidate.direction,
    };
  }
}

function cueKey(candidate: Candidate): string {
  return `${candidate.rule.id}:${candidate.direction}`;
}
