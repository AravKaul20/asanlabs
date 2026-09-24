/**
 * On-disk formats for the eval corpus.
 *
 * A recording is what the web app's Record mode downloads: smoothed world and
 * image landmarks with timestamps. Never video, and never raw frames.
 *
 * A label file sits beside it and says which pose was being practised, who was
 * practising (so splits can be made by person), and when each mistake occurred.
 */
import { z } from "zod";
import { LANDMARK_COUNT } from "@asan/core";

const landmark = z.strictObject({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  visibility: z.number().min(0).max(1),
});

const landmarkArray = z
  .array(landmark)
  .length(LANDMARK_COUNT, `expected ${LANDMARK_COUNT} pose landmarks`);

export const frameSchema = z.strictObject({
  /** Milliseconds from the start of the recording. */
  t: z.number().nonnegative(),
  world: landmarkArray,
  image: landmarkArray,
  visibility: z.array(z.number().min(0).max(1)).length(LANDMARK_COUNT),
});

export const recordingSchema = z
  .strictObject({
    version: z.literal(1),
    /** Free-form capture metadata: device, model variant, frame times. */
    meta: z.record(z.string(), z.unknown()).optional(),
    frames: z.array(frameSchema).min(2, "a recording needs at least two frames"),
  })
  .refine(
    (r) => r.frames.every((f, i) => i === 0 || f.t > (r.frames[i - 1]?.t ?? -1)),
    "frame timestamps must strictly increase",
  );

export const mistakeSchema = z
  .strictObject({
    ruleId: z.string().min(1),
    /** Milliseconds, on the same clock as the recording's frame timestamps. */
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
  })
  .refine((m) => m.end > m.start, "a mistake must end after it starts");

export const labelSchema = z.strictObject({
  /** Recording filename this label describes, relative to the same directory. */
  recording: z.string().min(1),
  pose: z.string().min(1),
  side: z.enum(["left", "right"]),
  /**
   * Who was in the recording. Splits are made by person and never by frame:
   * frames from one hold are near-duplicates, so splitting them would leak.
   */
  person: z.string().min(1),
  mistakes: z.array(mistakeSchema),
  notes: z.string().optional(),
});

export type Recording = z.infer<typeof recordingSchema>;
export type LabelFile = z.infer<typeof labelSchema>;
export type Mistake = z.infer<typeof mistakeSchema>;
