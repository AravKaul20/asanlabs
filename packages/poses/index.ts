/**
 * @asan/poses — the pose library.
 *
 * Each pose is a JSON file, validated against the core schema at import time.
 * Adding or tuning a pose means editing data: a new pose is a JSON file plus one
 * line here, and never an engine change.
 *
 * Every rule carries `source: "self"` — these ranges are our own reading of the
 * poses, not an instructor's, and the eval harness is what will tell us whether
 * they match real bodies.
 */
import { parsePose, type PoseDefinition } from "@asan/core";
import mountainJson from "./mountain.json" with { type: "json" };
import warriorIIJson from "./warrior-ii.json" with { type: "json" };

/** Throws at import time if a pose file is malformed, so a bad file fails loudly. */
export const mountain: PoseDefinition = parsePose(mountainJson);
export const warriorII: PoseDefinition = parsePose(warriorIIJson);

export const POSES: readonly PoseDefinition[] = [mountain, warriorII];

export const POSE_IDS: readonly string[] = POSES.map((p) => p.id);

export function getPose(id: string): PoseDefinition | undefined {
  return POSES.find((p) => p.id === id);
}
