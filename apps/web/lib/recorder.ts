/**
 * Record mode: saves the smoothed landmark stream as JSON for the eval harness.
 *
 * Landmarks only. No video, no frames, no images — there is nothing here that
 * could reconstruct what the room looked like, and nothing leaves the device
 * except by the user's own download.
 *
 * The format is exactly what tools/eval reads, so a clip recorded here can be
 * labelled and replayed without conversion.
 */
import type { Frame } from "@asan/core";
import type { ModelVariant } from "./adaptive.ts";

export interface RecorderMeta {
  pose: string;
  side: string;
  modelVariant: ModelVariant;
  userAgent: string;
}

/** 3 decimals of a metre is 1 mm, well inside MediaPipe's own error. */
const round = (n: number, places: number) => Number(n.toFixed(places));

export class Recorder {
  private frames: Frame[] = [];
  private startedAt: number | null = null;

  get recording(): boolean {
    return this.startedAt !== null;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  get durationMs(): number {
    const first = this.frames[0]?.t ?? 0;
    const last = this.frames[this.frames.length - 1]?.t ?? first;
    return last - first;
  }

  start(now: number): void {
    this.frames = [];
    this.startedAt = now;
  }

  /** Add a smoothed frame. Timestamps are rebased so a clip starts at zero. */
  add(frame: Frame): void {
    if (this.startedAt === null) return;
    this.frames.push({ ...frame, t: Math.round(frame.t - this.startedAt) });
  }

  stop(): void {
    this.startedAt = null;
  }

  /** The recording as the eval harness expects it. */
  toJSON(meta: RecorderMeta): unknown {
    return {
      version: 1,
      meta: { ...meta, recordedAt: new Date().toISOString(), frames: this.frames.length },
      frames: this.frames.map((frame) => ({
        t: frame.t,
        world: frame.world.map((p) => ({
          x: round(p.x, 3),
          y: round(p.y, 3),
          z: round(p.z, 3),
          visibility: round(p.visibility, 2),
        })),
        image: frame.image.map((p) => ({
          x: round(p.x, 4),
          y: round(p.y, 4),
          z: round(p.z, 4),
          visibility: round(p.visibility, 2),
        })),
        visibility: frame.visibility.map((v) => round(v, 2)),
      })),
    };
  }

  suggestedFilename(meta: RecorderMeta): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `${meta.pose}-${meta.side}-${stamp}.json`;
  }
}

/** Hand the file to the user. Nothing is uploaded. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
