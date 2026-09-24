/**
 * The Settle Gate decides when the user is actually in the pose.
 *
 * Guided sessions mean there is no classifier: the app already knows the target
 * pose. What it needs to know is when to start judging. The gate asks two
 * things — has the body stopped moving, and is it roughly in the right shape —
 * and only then hands over to the rule engine.
 *
 * Time comes from frame timestamps, never a wall clock.
 */
import { distance } from "./geometry.ts";
import { landmarkIndex } from "./landmarks.ts";
import { VISIBILITY_THRESHOLD } from "./ruleEngine.ts";
import { resolveFeatureName } from "./features/extractor.ts";
import type { PoseDefinition } from "./pose/schema.ts";
import type { Features, Frame, Side, WorldLandmark } from "./types.ts";

export interface SettleGateConfig {
  /** Mean landmark speed, in m/s, below which the body counts as still. */
  velocityThreshold?: number;
  /** How long stillness must hold before the pose counts as entered, in ms. */
  stillDurationMs?: number;
}

export interface SettleState {
  settled: boolean;
  /** Mean speed of the pose's required landmarks, in m/s. */
  meanVelocity: number;
  /** Whether every settleShape range currently passes. */
  shapeOk: boolean;
  /** How long the body has been continuously still, in ms. */
  stillForMs: number;
}

const DEFAULTS = { velocityThreshold: 0.1, stillDurationMs: 1000 } as const;

export class SettleGate {
  private readonly velocityThreshold: number;
  private readonly stillDurationMs: number;
  private prev: { t: number; world: WorldLandmark[] } | null = null;
  private stillSince: number | null = null;

  constructor(config: SettleGateConfig = {}) {
    this.velocityThreshold = config.velocityThreshold ?? DEFAULTS.velocityThreshold;
    this.stillDurationMs = config.stillDurationMs ?? DEFAULTS.stillDurationMs;
  }

  update(frame: Frame, features: Features, pose: PoseDefinition, side: Side): SettleState {
    const tracked = this.trackedIndices(frame, pose);
    // Losing a required landmark is treated as "not still": we would rather wait
    // than start coaching a body we cannot see.
    const trackingOk = tracked.length === pose.requiredLandmarks.length;
    const meanVelocity = this.meanVelocity(frame, tracked);

    if (!trackingOk || meanVelocity > this.velocityThreshold) {
      this.stillSince = null;
    } else if (this.stillSince === null) {
      this.stillSince = frame.t;
    }

    this.prev = { t: frame.t, world: frame.world };

    const stillForMs = this.stillSince === null ? 0 : frame.t - this.stillSince;
    const shapeOk = trackingOk && this.shapeOk(features, pose, side);
    return {
      settled: shapeOk && stillForMs >= this.stillDurationMs,
      meanVelocity,
      shapeOk,
      stillForMs,
    };
  }

  reset(): void {
    this.prev = null;
    this.stillSince = null;
  }

  /** Indices of the pose's required landmarks that are visible enough to trust. */
  private trackedIndices(frame: Frame, pose: PoseDefinition): number[] {
    const out: number[] = [];
    for (const name of pose.requiredLandmarks) {
      const i = landmarkIndex(name);
      if (i === undefined) continue;
      const visibility = frame.visibility[i] ?? frame.world[i]?.visibility ?? 0;
      if (visibility >= VISIBILITY_THRESHOLD) out.push(i);
    }
    return out;
  }

  private meanVelocity(frame: Frame, tracked: readonly number[]): number {
    const prev = this.prev;
    if (!prev || tracked.length === 0) return 0;
    const dt = (frame.t - prev.t) / 1000;
    if (dt <= 0) return 0;

    let total = 0;
    let counted = 0;
    for (const i of tracked) {
      const now = frame.world[i];
      const before = prev.world[i];
      if (!now || !before) continue;
      total += distance(now, before) / dt;
      counted++;
    }
    return counted === 0 ? 0 : total / counted;
  }

  private shapeOk(features: Features, pose: PoseDefinition, side: Side): boolean {
    for (const shape of pose.settleShape) {
      const feature = features.values[resolveFeatureName(shape.feature, side)];
      if (
        feature === undefined ||
        !Number.isFinite(feature.value) ||
        feature.minVisibility < VISIBILITY_THRESHOLD
      ) {
        return false;
      }
      const [min, max] = shape.range;
      if (feature.value < min || feature.value > max) return false;
    }
    return true;
  }
}
