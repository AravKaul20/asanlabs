/**
 * Adaptive performance ladder.
 *
 * Start on the Full model. If the rolling average frame time stays above 66 ms
 * (15 fps) for 3 s, step down: Full -> Lite -> Lite processing every other frame.
 * If it is still under 10 fps at the bottom of the ladder, say so plainly.
 *
 * It never steps back up. Recovery would need its own hysteresis to avoid
 * flapping between models mid-session, and a swap costs a landmarker rebuild, so
 * a session settles on the level the device can sustain and stays there.
 *
 * Pure logic with injected time, so it is testable without a camera.
 */

export type ModelVariant = "full" | "lite";

export interface AdaptiveState {
  variant: ModelVariant;
  /** 1 = process every frame, 2 = every other frame. */
  frameStride: number;
  /** True once the device cannot hold 10 fps even at the bottom of the ladder. */
  slowDevice: boolean;
}

const LADDER: readonly AdaptiveState[] = [
  { variant: "full", frameStride: 1, slowDevice: false },
  { variant: "lite", frameStride: 1, slowDevice: false },
  { variant: "lite", frameStride: 2, slowDevice: false },
];

export interface AdaptiveConfig {
  /** Frame time above which the device is judged too slow, in ms. 66 ms = 15 fps. */
  targetFrameMs?: number;
  /** How long the target must be missed before stepping down, in ms. */
  sustainMs?: number;
  /** Rolling window used for the average, in ms. */
  windowMs?: number;
  /** Frame time that counts as the floor, in ms. 100 ms = 10 fps. */
  floorFrameMs?: number;
}

const DEFAULTS = {
  targetFrameMs: 66,
  sustainMs: 3000,
  windowMs: 1000,
  floorFrameMs: 100,
} as const;

export class AdaptiveController {
  private readonly targetFrameMs: number;
  private readonly sustainMs: number;
  private readonly windowMs: number;
  private readonly floorFrameMs: number;

  private stage = 0;
  private slow = false;
  private overTargetSince: number | null = null;
  private overFloorSince: number | null = null;
  private samples: Array<{ t: number; ms: number }> = [];
  private lastFrameAt: number | null = null;
  private intervals: Array<{ t: number; ms: number }> = [];

  constructor(config: AdaptiveConfig = {}) {
    this.targetFrameMs = config.targetFrameMs ?? DEFAULTS.targetFrameMs;
    this.sustainMs = config.sustainMs ?? DEFAULTS.sustainMs;
    this.windowMs = config.windowMs ?? DEFAULTS.windowMs;
    this.floorFrameMs = config.floorFrameMs ?? DEFAULTS.floorFrameMs;
  }

  /**
   * Record one processed frame.
   * @param processingMs how long detect plus the pipeline took
   * @param now monotonic clock reading
   * @returns true if the ladder level changed and the caller must react
   */
  record(processingMs: number, now: number): boolean {
    this.samples.push({ t: now, ms: processingMs });
    this.samples = this.samples.filter((s) => now - s.t <= this.windowMs);

    if (this.lastFrameAt !== null) {
      this.intervals.push({ t: now, ms: now - this.lastFrameAt });
      this.intervals = this.intervals.filter((s) => now - s.t <= this.windowMs);
    }
    this.lastFrameAt = now;

    const avg = this.avgFrameMs;
    const before = this.stage;

    if (avg > this.targetFrameMs) {
      this.overTargetSince ??= now;
      if (now - this.overTargetSince >= this.sustainMs && this.stage < LADDER.length - 1) {
        this.stage++;
        // Give the new level a fresh window to prove itself.
        this.overTargetSince = null;
        this.samples = [];
      }
    } else {
      this.overTargetSince = null;
    }

    // The slow-device notice is about the bottom of the ladder, not the way down.
    if (this.stage === LADDER.length - 1 && avg > this.floorFrameMs) {
      this.overFloorSince ??= now;
      if (now - this.overFloorSince >= this.sustainMs) this.slow = true;
    } else if (avg <= this.floorFrameMs) {
      this.overFloorSince = null;
    }

    return this.stage !== before;
  }

  get state(): AdaptiveState {
    const level = LADDER[this.stage] ?? LADDER[0]!;
    return { ...level, slowDevice: this.slow };
  }

  /** Rolling mean processing time per frame, in ms. */
  get avgFrameMs(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((sum, s) => sum + s.ms, 0) / this.samples.length;
  }

  /** Processed frames per second, measured from wall-clock gaps between frames. */
  get fps(): number {
    if (this.intervals.length === 0) return 0;
    const mean = this.intervals.reduce((sum, s) => sum + s.ms, 0) / this.intervals.length;
    return mean > 0 ? 1000 / mean : 0;
  }

  reset(): void {
    this.stage = 0;
    this.slow = false;
    this.overTargetSince = null;
    this.overFloorSince = null;
    this.samples = [];
    this.intervals = [];
    this.lastFrameAt = null;
  }
}
