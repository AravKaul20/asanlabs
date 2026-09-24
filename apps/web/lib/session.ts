/**
 * Runs the core pipeline for one practice session.
 *
 * Deliberately free of React and of the DOM (beyond the Voice it is handed), so
 * the coaching logic can be driven by a test with synthetic frames rather than a
 * camera. The page below is then only wiring and pixels.
 *
 * Camera -> [smoother -> features -> settle gate -> rules -> cues] -> voice/screen
 */
import {
  CueManager,
  FeatureExtractor,
  FormScore,
  FrameSmoother,
  RuleEngine,
  SettleGate,
  type EvalResult,
  type Frame,
  type PoseDefinition,
  type RuleResult,
  type Side,
} from "@asan/core";
import { checkSetup, type SetupStatus } from "./setupCheck.ts";
import type { DetectResult } from "./poseLandmarker.ts";
import type { Speaker } from "./voice.ts";

/** How long a "Good." stays on screen after a fix. */
const CONFIRMATION_MS = 1600;

export interface SessionState {
  setup: SetupStatus;
  settled: boolean;
  /** Text to show large on screen — the same words the voice said. */
  message: string | null;
  messageKind: "cue" | "confirmation" | null;
  highlight: string[];
  /** Weighted pass share averaged over the hold, 0..100. */
  score: number;
  instantScore: number;
  holdSeconds: number;
  ruleStates: RuleResult[];
  meanVelocity: number;
  /** The smoothed frame, for drawing and for Record mode. */
  frame: Frame | null;
}

export function poseUsesSides(pose: PoseDefinition): boolean {
  return pose.rules.some((r) => r.feature.startsWith("front_") || r.feature.startsWith("back_"));
}

export class PracticeSession {
  private readonly smoother = new FrameSmoother();
  private readonly extractor = new FeatureExtractor();
  private readonly gate = new SettleGate();
  private readonly engine = new RuleEngine();
  private readonly cues = new CueManager();
  private readonly form = new FormScore();

  private prev: EvalResult | null = null;
  private message: string | null = null;
  private messageKind: "cue" | "confirmation" | null = null;
  private messageExpiresAt: number | null = null;
  private highlight: string[] = [];

  constructor(
    private readonly pose: PoseDefinition,
    private readonly side: Side,
    private readonly voice: Speaker,
  ) {}

  /**
   * Process one detection.
   * @param now monotonic time, used for the cue policy's rate limits
   */
  process(detect: DetectResult, now: number): SessionState {
    const smoothed = detect.frame ? this.smoother.smooth(detect.frame) : null;
    const setup = checkSetup({ poseCount: detect.poseCount, frame: smoothed, pose: this.pose });

    if (!setup.ready || !smoothed) {
      // Nothing to coach: clear whatever was on screen and stay quiet.
      this.applyEvents(this.cues.update([], this.pose, now), now);
      this.prev = null;
      return this.snapshot(setup, false, 0, [], smoothed, now);
    }

    const features = this.extractor.extract(smoothed, this.side);
    const settle = this.gate.update(smoothed, features, this.pose, this.side);

    if (!settle.settled) {
      // Between poses. Hysteresis state is dropped so re-entering the pose is
      // judged cleanly rather than inheriting a stale verdict.
      this.applyEvents(this.cues.update([], this.pose, now), now);
      this.prev = null;
      return this.snapshot(setup, false, settle.meanVelocity, [], smoothed, now);
    }

    const result = this.engine.evaluate(features, this.pose, this.side, this.prev);
    this.prev = result;
    this.form.update(result);
    this.applyEvents(this.cues.update(result.results, this.pose, now), now);

    return this.snapshot(setup, true, settle.meanVelocity, result.results, smoothed, now);
  }

  private applyEvents(events: ReturnType<CueManager["update"]>, now: number): void {
    for (const event of events) {
      if (event.type === "cue") {
        this.message = event.cue.text;
        this.messageKind = "cue";
        this.messageExpiresAt = null;
        this.highlight = [...event.cue.highlight];
        this.voice.say(event.cue.text);
      } else if (event.type === "fixed") {
        this.message = event.text;
        this.messageKind = "confirmation";
        this.messageExpiresAt = now + CONFIRMATION_MS;
        this.highlight = [];
        this.voice.say(event.text);
      } else {
        this.message = null;
        this.messageKind = null;
        this.messageExpiresAt = null;
        this.highlight = [];
      }
    }

    if (this.messageExpiresAt !== null && now >= this.messageExpiresAt) {
      this.message = null;
      this.messageKind = null;
      this.messageExpiresAt = null;
    }
  }

  private snapshot(
    setup: SetupStatus,
    settled: boolean,
    meanVelocity: number,
    ruleStates: RuleResult[],
    frame: Frame | null,
    _now: number,
  ): SessionState {
    return {
      setup,
      settled,
      message: this.message,
      messageKind: this.messageKind,
      highlight: this.highlight,
      score: this.form.average,
      instantScore: this.form.instant,
      holdSeconds: this.form.holdSeconds,
      ruleStates,
      meanVelocity,
      frame,
    };
  }

  reset(): void {
    this.smoother.reset();
    this.gate.reset();
    this.cues.reset();
    this.form.reset();
    this.prev = null;
    this.message = null;
    this.messageKind = null;
    this.messageExpiresAt = null;
    this.highlight = [];
    this.voice.cancel();
  }
}
