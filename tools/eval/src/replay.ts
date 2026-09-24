/**
 * Replays a recording through the engine, frame by frame, exactly as the live
 * pipeline would.
 *
 * Recordings hold already-smoothed landmarks (that is what Record mode saves),
 * so the smoother is not re-applied here. Everything downstream is deterministic
 * given the frames, so a replay is reproducible.
 */
import {
  FeatureExtractor,
  RuleEngine,
  SettleGate,
  type EvalResult,
  type Frame,
  type PoseDefinition,
  type RuleStatus,
  type Side,
} from "@asan/core";
import type { Recording } from "./schema.ts";

export interface ReplayFrame {
  t: number;
  settled: boolean;
  /** Per-rule status for this frame, keyed by rule id. */
  statuses: Record<string, RuleStatus>;
  score: number;
  judged: boolean;
}

export interface ReplayResult {
  frames: ReplayFrame[];
  /** Total recording span, in ms. */
  durationMs: number;
  /** Span the gate considered settled, in ms. */
  settledMs: number;
}

/** Turn a stored frame into the engine's Frame shape. */
function toFrame(stored: Recording["frames"][number]): Frame {
  return {
    t: stored.t,
    world: stored.world,
    image: stored.image,
    visibility: stored.visibility,
  };
}

export function replay(recording: Recording, pose: PoseDefinition, side: Side): ReplayResult {
  const extractor = new FeatureExtractor();
  const gate = new SettleGate();
  const engine = new RuleEngine();

  const frames: ReplayFrame[] = [];
  let prev: EvalResult | null = null;
  let settledMs = 0;
  let prevT: number | null = null;

  for (const stored of recording.frames) {
    const frame = toFrame(stored);
    const features = extractor.extract(frame, side);
    const settle = gate.update(frame, features, pose, side);

    // Only judge once the gate says the user is in the pose — that is what the
    // live app does, so the metrics must be measured the same way.
    const result: EvalResult | null = settle.settled
      ? engine.evaluate(features, pose, side, prev)
      : null;
    if (result) prev = result;
    else prev = null; // leaving the pose resets hysteresis state

    const dt = prevT === null ? 0 : frame.t - prevT;
    if (settle.settled) settledMs += dt;
    prevT = frame.t;

    const statuses: Record<string, RuleStatus> = {};
    if (result) for (const r of result.results) statuses[r.ruleId] = r.status;

    frames.push({
      t: frame.t,
      settled: settle.settled,
      statuses,
      score: result?.score ?? 0,
      judged: result?.judged ?? false,
    });
  }

  const first = recording.frames[0]?.t ?? 0;
  const last = recording.frames[recording.frames.length - 1]?.t ?? first;
  return { frames, durationMs: last - first, settledMs };
}
