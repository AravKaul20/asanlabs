/**
 * The pose schema. Poses are data, not code: a pose is a JSON file, validated
 * here, and adding or tuning one must never require an engine change.
 *
 * Validation is deliberately strict — unknown keys are rejected and every
 * feature and joint name is checked against the registry — so a typo in a pose
 * file fails at load time rather than silently disabling a rule.
 */
import { z } from "zod";
import { isJointReference } from "../landmarks.ts";
import { isLandmarkName } from "../landmarks.ts";
import { isKnownFeature } from "../features/extractor.ts";

const slug = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase slug, e.g. warrior-ii");

const featureName = z.string().refine(isKnownFeature, {
  error: (issue) =>
    `unknown feature "${String(issue.input)}" — add it to the feature registry or fix the spelling`,
});

const jointReference = z.string().refine(isJointReference, {
  error: (issue) =>
    `unknown joint "${String(issue.input)}" — use a pose landmark name or a front_/back_ form`,
});

const landmarkName = z.string().refine(isLandmarkName, {
  error: (issue) => `unknown landmark "${String(issue.input)}"`,
});

/** An inclusive [min, max] band. */
const range = z
  .tuple([z.number(), z.number()])
  .refine(([min, max]) => min <= max, "range must be [min, max] with min <= max");

export const sideSchema = z.enum(["left", "right"]);
export const prioritySchema = z.enum(["safety", "alignment", "refinement"]);
export const viewSchema = z.enum(["front", "side"]);
export const sourceSchema = z.enum(["self", "instructor"]);

/** Wording for each direction of failure. At least one direction must be covered. */
const cuesSchema = z
  .strictObject({
    tooLow: z.array(z.string().min(1)).min(1).optional(),
    tooHigh: z.array(z.string().min(1)).min(1).optional(),
  })
  .refine(
    (c) => c.tooLow !== undefined || c.tooHigh !== undefined,
    "a rule needs at least one of cues.tooLow or cues.tooHigh, or it can never speak",
  );

export const ruleSchema = z.strictObject({
  id: slug,
  priority: prioritySchema,
  feature: featureName,
  range,
  /**
   * Deadband, in the feature's own unit. A rule that is currently passing must
   * exceed its range by this much before it starts failing; a failing rule must
   * come back strictly inside the range to pass. Sticky toward the current
   * state, which is what stops a cue flickering on and off at the boundary.
   */
  hysteresis: z.number().min(0),
  cues: cuesSchema,
  highlight: z.array(jointReference).min(1),
  /** Relative contribution to the form score. Must be positive to count. */
  weight: z.number().positive(),
  source: sourceSchema,
});

/** A band the body must be in before the Settle Gate calls the pose entered. */
export const settleShapeSchema = z.strictObject({
  feature: featureName,
  range,
});

export const poseSchema = z
  .strictObject({
    id: slug,
    name: z.string().min(1),
    version: z.number().int().positive(),
    view: viewSchema,
    sides: z.array(sideSchema).min(1),
    requiredLandmarks: z.array(landmarkName).min(1),
    settleShape: z.array(settleShapeSchema),
    rules: z.array(ruleSchema).min(1),
  })
  .refine((p) => new Set(p.sides).size === p.sides.length, "sides must not contain duplicates")
  .refine((p) => {
    const ids = p.rules.map((r) => r.id);
    return new Set(ids).size === ids.length;
  }, "duplicate rule id: rule ids must be unique within a pose");

export type PoseDefinition = z.infer<typeof poseSchema>;
export type PoseRule = z.infer<typeof ruleSchema>;
export type SettleShape = z.infer<typeof settleShapeSchema>;

/** Parse and validate a pose, throwing a readable error on failure. */
export function parsePose(input: unknown): PoseDefinition {
  return poseSchema.parse(input);
}

export function safeParsePose(input: unknown) {
  return poseSchema.safeParse(input);
}
