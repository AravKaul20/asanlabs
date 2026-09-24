/**
 * The per-frame loop: detect, run the pipeline, draw, adapt.
 *
 * Kept out of React so the loop is plain imperative code with no hook rules to
 * work around. The hook above it only mirrors what this reports into state.
 *
 * MediaPipe is imported dynamically so its wasm bundle is never evaluated during
 * server rendering.
 */
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import type { PoseDefinition, Side } from "@asan/core";
import { AdaptiveController, type ModelVariant } from "./adaptive.ts";
import type { CreateLandmarker, ToFrame } from "./poseLandmarker.ts";
import { drawSkeleton, sizeCanvasToVideo } from "./overlay.ts";
import type { Recorder } from "./recorder.ts";
import { PracticeSession, type SessionState } from "./session.ts";
import type { Speaker } from "./voice.ts";

export interface Perf {
  variant: ModelVariant;
  frameStride: number;
  slowDevice: boolean;
  fps: number;
  frameMs: number;
}

export interface RunnerOptions {
  video: HTMLVideoElement;
  canvas: () => HTMLCanvasElement | null;
  pose: PoseDefinition;
  side: Side;
  voice: Speaker;
  recorder: Recorder;
  onState: (state: SessionState) => void;
  onPerf: (perf: Perf) => void;
  onRecordedFrames: (count: number) => void;
}

export class PracticeRunner {
  private readonly adaptive = new AdaptiveController();
  private readonly session: PracticeSession;
  private landmarker: PoseLandmarker | null = null;
  private createLandmarker: CreateLandmarker | null = null;
  private toFrame: ToFrame | null = null;
  private raf = 0;
  private running = false;
  private swapping = false;
  private frameIndex = 0;
  private lastVideoTime = -1;

  constructor(private readonly options: RunnerOptions) {
    this.session = new PracticeSession(options.pose, options.side, options.voice);
  }

  /** Loads the model and starts the loop. Throws if the model cannot be loaded. */
  async start(): Promise<void> {
    const module = await import("./poseLandmarker.ts");
    this.createLandmarker = module.createLandmarker;
    this.toFrame = module.toFrame;
    this.landmarker = await module.createLandmarker("full");
    this.running = true;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.landmarker?.close();
    this.landmarker = null;
  }

  private readonly tick = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    const { video } = this.options;
    const landmarker = this.landmarker;
    const toFrame = this.toFrame;
    if (!landmarker || !toFrame || video.videoWidth === 0) return;

    // Frame striding, for devices that cannot keep up at full rate.
    this.frameIndex++;
    if (this.frameIndex % this.adaptive.state.frameStride !== 0) return;
    // MediaPipe needs a genuinely new video frame on each call.
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    const startedAt = performance.now();
    let state: SessionState;
    try {
      state = this.session.process(
        toFrame(landmarker.detectForVideo(video, startedAt), startedAt),
        startedAt,
      );
    } catch {
      return; // one dropped frame is not worth ending the session over
    }

    if (this.adaptive.record(performance.now() - startedAt, startedAt)) {
      void this.swapModel(this.adaptive.state.variant);
    }

    this.draw(state);

    const recorder = this.options.recorder;
    if (state.frame && recorder.recording) {
      recorder.add(state.frame);
      this.options.onRecordedFrames(recorder.frameCount);
    }

    this.options.onState(state);
    this.options.onPerf({
      ...this.adaptive.state,
      fps: this.adaptive.fps,
      frameMs: this.adaptive.avgFrameMs,
    });
  };

  private draw(state: SessionState): void {
    const canvas = this.options.canvas();
    if (!canvas) return;
    sizeCanvasToVideo(canvas, this.options.video);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawSkeleton(ctx, { landmarks: state.frame?.image ?? [], highlight: state.highlight });
  }

  /**
   * Swapping model variants means building a second landmarker: MediaPipe cannot
   * hot-swap the model behind an existing one. That costs a brief hitch, which is
   * the price of not dropping below 10 fps for the rest of the session.
   */
  private async swapModel(variant: ModelVariant): Promise<void> {
    if (this.swapping || !this.createLandmarker) return;
    this.swapping = true;
    try {
      const replacement = await this.createLandmarker(variant);
      if (!this.running) {
        replacement.close();
        return;
      }
      this.landmarker?.close();
      this.landmarker = replacement;
    } catch {
      // Stay on the current model rather than ending the session.
    } finally {
      this.swapping = false;
    }
  }
}
