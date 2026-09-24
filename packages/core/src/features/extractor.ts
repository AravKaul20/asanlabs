/**
 * Turns one frame of world landmarks into named features.
 *
 * On top of the explicit left_ / right_ names, every sided feature is also
 * reachable as front_ / back_ for the session's active side, so a pose JSON can
 * say `front_knee_angle` and work on either side without duplicating rules.
 */
import { landmarkIndex, otherSide, type LandmarkName } from "../landmarks.ts";
import type { Features, FeatureValue, Frame, Side } from "../types.ts";
import type { Vec3 } from "../geometry.ts";
import { FEATURE_DESCRIPTORS, SIDED_FEATURE_BASES, getDescriptor } from "./registry.ts";

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/** Every feature name the extractor emits under explicit left/right naming. */
export const FEATURE_NAMES: readonly string[] = FEATURE_DESCRIPTORS.map((d) => d.name);

/** front_knee_angle -> left_knee_angle, given which side is front. */
export function resolveFeatureName(name: string, side: Side): string {
  for (const base of SIDED_FEATURE_BASES) {
    if (name === `front_${base}`) return `${side}_${base}`;
    if (name === `back_${base}`) return `${otherSide(side)}_${base}`;
  }
  return name;
}

/**
 * Landmarks a feature depends on, for callers that need to gate on visibility
 * or highlight joints. Accepts front_ / back_ names when a side is supplied.
 */
export function featureLandmarks(name: string, side?: Side): readonly LandmarkName[] | undefined {
  const resolved = side ? resolveFeatureName(name, side) : name;
  return getDescriptor(resolved)?.landmarks;
}

/** True if this name is a feature the engine can evaluate (either naming style). */
export function isKnownFeature(name: string): boolean {
  if (getDescriptor(name)) return true;
  return SIDED_FEATURE_BASES.some((base) => name === `front_${base}` || name === `back_${base}`);
}

export class FeatureExtractor {
  extract(frame: Frame, side: Side): Features {
    const get = (name: LandmarkName): Vec3 => {
      const i = landmarkIndex(name);
      if (i === undefined) return ORIGIN;
      return frame.world[i] ?? ORIGIN;
    };
    const visibilityOf = (name: LandmarkName): number => {
      const i = landmarkIndex(name);
      if (i === undefined) return 0;
      return frame.visibility[i] ?? frame.world[i]?.visibility ?? 0;
    };

    const values: Record<string, FeatureValue> = {};
    for (const descriptor of FEATURE_DESCRIPTORS) {
      let minVisibility = 1;
      for (const landmark of descriptor.landmarks) {
        minVisibility = Math.min(minVisibility, visibilityOf(landmark));
      }
      values[descriptor.name] = { value: descriptor.compute(get), minVisibility };
    }

    // Side aliases point at the same FeatureValue object, so they stay in sync.
    const back = otherSide(side);
    for (const base of SIDED_FEATURE_BASES) {
      const front = values[`${side}_${base}`];
      const rear = values[`${back}_${base}`];
      if (front) values[`front_${base}`] = front;
      if (rear) values[`back_${base}`] = rear;
    }

    return { t: frame.t, side, values };
  }
}
