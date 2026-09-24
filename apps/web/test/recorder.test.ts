/**
 * Record mode writes the format the eval harness reads. This asserts that
 * contract directly, against the harness's own schema, so the two cannot drift
 * apart silently and leave a recorded clip unusable.
 */
import { describe, expect, it } from "vitest";
import { Recorder } from "../lib/recorder.ts";
import { recordingSchema } from "@asan/eval/src/schema.ts";
import { MOUNTAIN, buildFrame } from "@asan/core/testing";
import { FrameSmoother } from "@asan/core";

const meta = {
  pose: "mountain",
  side: "left" as const,
  modelVariant: "full" as const,
  userAgent: "test",
};

/** Record a short clip of smoothed frames, as the live loop would. */
function record(frameCount = 10): Recorder {
  const recorder = new Recorder();
  const smoother = new FrameSmoother();
  recorder.start(1000);
  for (let i = 0; i < frameCount; i++) {
    const t = 1000 + Math.round((i * 1000) / 15);
    recorder.add(smoother.smooth(buildFrame(t, MOUNTAIN)));
  }
  return recorder;
}

describe("Recorder output", () => {
  it("validates against the eval harness's recording schema", () => {
    const result = recordingSchema.safeParse(record().toJSON(meta));
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("rebases timestamps so a clip starts at zero", () => {
    const parsed = recordingSchema.parse(record().toJSON(meta));
    expect(parsed.frames[0]?.t).toBe(0);
  });

  it("keeps timestamps strictly increasing, as the schema demands", () => {
    const parsed = recordingSchema.parse(record(30).toJSON(meta));
    for (let i = 1; i < parsed.frames.length; i++) {
      expect(parsed.frames[i]!.t).toBeGreaterThan(parsed.frames[i - 1]!.t);
    }
  });

  it("stores all 33 world and image landmarks per frame", () => {
    const parsed = recordingSchema.parse(record().toJSON(meta));
    for (const frame of parsed.frames) {
      expect(frame.world).toHaveLength(33);
      expect(frame.image).toHaveLength(33);
      expect(frame.visibility).toHaveLength(33);
    }
  });

  it("records capture metadata for later triage", () => {
    const parsed = recordingSchema.parse(record().toJSON(meta));
    expect(parsed.meta).toMatchObject({ pose: "mountain", side: "left", modelVariant: "full" });
    expect(parsed.meta?.recordedAt).toBeTypeOf("string");
  });

  it("contains no image or video data of any kind, only coordinates", () => {
    const json = JSON.stringify(record().toJSON(meta));
    expect(json).not.toMatch(/data:|base64|blob:|image\/|video\//);
  });

  it("reports frame count and duration while recording", () => {
    const recorder = record(15);
    expect(recorder.frameCount).toBe(15);
    expect(recorder.durationMs).toBeGreaterThan(900);
    expect(recorder.recording).toBe(true);
  });

  it("ignores frames added before recording starts", () => {
    const recorder = new Recorder();
    recorder.add(buildFrame(0, MOUNTAIN));
    expect(recorder.frameCount).toBe(0);
  });

  it("suggests a filename naming the pose and side", () => {
    expect(record().suggestedFilename(meta)).toMatch(/^mountain-left-.*\.json$/);
  });

  it("starts a fresh clip on each start", () => {
    const recorder = record(5);
    recorder.start(9000);
    expect(recorder.frameCount).toBe(0);
  });
});

describe("round trip: Record mode to the eval harness", () => {
  it("replays a recorded clip through the harness and judges the pose", async () => {
    const { replay } = await import("@asan/eval/src/replay.ts");
    const { MetricsAccumulator } = await import("@asan/eval/src/metrics.ts");
    const { mountain } = await import("@asan/poses");

    // A recorded clip of a correct, still Mountain, long enough for the gate.
    const recorder = new Recorder();
    const smoother = new FrameSmoother();
    recorder.start(0);
    for (let i = 0; i < 90; i++) {
      recorder.add(smoother.smooth(buildFrame(Math.round((i * 1000) / 15), MOUNTAIN)));
    }

    const recording = recordingSchema.parse(recorder.toJSON(meta));
    const result = replay(recording, mountain, "left");

    // The gate settles and every rule gets judged, on data that came out of the
    // app's own Record mode rather than a hand-built fixture.
    expect(result.settledMs).toBeGreaterThan(3000);
    const judged = result.frames.filter((f) => f.judged);
    expect(judged.length).toBeGreaterThan(40);
    expect(judged[judged.length - 1]?.score).toBe(100);

    // And it produces no false alarms on a clip labelled as correct throughout.
    const accumulator = new MetricsAccumulator();
    accumulator.add(result, mountain, []);
    for (const metrics of accumulator.results()) {
      expect(metrics.falseAlarmEvents, metrics.ruleId).toBe(0);
    }
  });
});
