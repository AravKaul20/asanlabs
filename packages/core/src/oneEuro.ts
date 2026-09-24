import { LANDMARK_COUNT } from "./landmarks.ts";
import type { Frame, Landmark, WorldLandmark } from "./types.ts";

export interface OneEuroConfig {
  /** Baseline low-pass cutoff in Hz. Lower is smoother but laggier. */
  minCutoff: number;
  /** How much the cutoff opens up with speed. Higher tracks fast motion, keeps jitter. */
  beta: number;
  /** Cutoff for the derivative estimate, in Hz. */
  dCutoff?: number;
}

const TWO_PI = Math.PI * 2;

function smoothingFactor(cutoffHz: number, dtSeconds: number): number {
  const tau = 1 / (TWO_PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

/**
 * One Euro filter for a single scalar coordinate.
 *
 * Speed-adaptive low pass: it smooths hard when the value is still (killing
 * landmark jitter during a hold) and opens up when the value moves fast (so a
 * genuine correction is not lagged into uselessness).
 *
 * Timestamps are in milliseconds. A non-advancing or backwards timestamp is
 * ignored and the previous output is returned, since dt would be undefined.
 */
export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;
  private xHat: number | null = null;
  private dxHat = 0;
  private tPrev = 0;

  constructor(config: OneEuroConfig) {
    if (!(config.minCutoff > 0)) throw new Error("OneEuroFilter: minCutoff must be > 0");
    if (config.beta < 0) throw new Error("OneEuroFilter: beta must be >= 0");
    const dCutoff = config.dCutoff ?? 1;
    if (!(dCutoff > 0)) throw new Error("OneEuroFilter: dCutoff must be > 0");
    this.minCutoff = config.minCutoff;
    this.beta = config.beta;
    this.dCutoff = dCutoff;
  }

  filter(value: number, t: number): number {
    if (this.xHat === null) {
      this.xHat = value;
      this.dxHat = 0;
      this.tPrev = t;
      return value;
    }
    const dt = (t - this.tPrev) / 1000;
    if (dt <= 0) return this.xHat;

    const dx = (value - this.xHat) / dt;
    const aD = smoothingFactor(this.dCutoff, dt);
    this.dxHat = aD * dx + (1 - aD) * this.dxHat;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxHat);
    const a = smoothingFactor(cutoff, dt);
    this.xHat = a * value + (1 - a) * this.xHat;
    this.tPrev = t;
    return this.xHat;
  }

  reset(): void {
    this.xHat = null;
    this.dxHat = 0;
    this.tPrev = 0;
  }
}

/** Tuned for pose landmarks in meters held roughly still at 15 fps. */
export const DEFAULT_COORD_CONFIG: OneEuroConfig = { minCutoff: 1.5, beta: 0.05, dCutoff: 1 };

/**
 * Visibility is a confidence, not a coordinate, but it is smoothed too: raw
 * visibility flickering across the 0.5 gate would make rules blink between
 * judged and skipped, jittering the form score. No beta — we want it lazy.
 */
export const DEFAULT_VISIBILITY_CONFIG: OneEuroConfig = { minCutoff: 1, beta: 0, dCutoff: 1 };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Applies One Euro to a whole frame: every world and image coordinate gets its
 * own filter, as does each landmark's visibility. Input frames are not mutated.
 */
export class FrameSmoother {
  private readonly world: OneEuroFilter[];
  private readonly image: OneEuroFilter[];
  private readonly visibility: OneEuroFilter[];

  constructor(
    coordConfig: OneEuroConfig = DEFAULT_COORD_CONFIG,
    visibilityConfig: OneEuroConfig = DEFAULT_VISIBILITY_CONFIG,
  ) {
    const axes = LANDMARK_COUNT * 3;
    this.world = Array.from({ length: axes }, () => new OneEuroFilter(coordConfig));
    this.image = Array.from({ length: axes }, () => new OneEuroFilter(coordConfig));
    this.visibility = Array.from(
      { length: LANDMARK_COUNT },
      () => new OneEuroFilter(visibilityConfig),
    );
  }

  smooth(frame: Frame): Frame {
    const visibility: number[] = [];
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const raw = frame.visibility[i] ?? frame.world[i]?.visibility ?? 0;
      visibility.push(clamp01(this.visibility[i]!.filter(raw, frame.t)));
    }
    return {
      t: frame.t,
      world: this.smoothPoints(frame.world, this.world, frame.t, visibility),
      image: this.smoothPoints(frame.image, this.image, frame.t, visibility),
      visibility,
    };
  }

  private smoothPoints<T extends Landmark | WorldLandmark>(
    points: readonly T[],
    filters: OneEuroFilter[],
    t: number,
    visibility: readonly number[],
  ): T[] {
    const out: T[] = [];
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const p = points[i];
      const base = i * 3;
      out.push({
        x: filters[base]!.filter(p?.x ?? 0, t),
        y: filters[base + 1]!.filter(p?.y ?? 0, t),
        z: filters[base + 2]!.filter(p?.z ?? 0, t),
        visibility: visibility[i] ?? 0,
      } as T);
    }
    return out;
  }

  reset(): void {
    for (const f of this.world) f.reset();
    for (const f of this.image) f.reset();
    for (const f of this.visibility) f.reset();
  }
}
