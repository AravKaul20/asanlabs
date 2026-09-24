"use client";
/** React wiring for the practice loop: the runner does the work, this mirrors it into state. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PoseDefinition, Side } from "@asan/core";
import { cameraErrorMessage, startCamera, type CameraHandle } from "./camera.ts";
import { Recorder, downloadJson } from "./recorder.ts";
import { PracticeRunner, type Perf } from "./practiceRunner.ts";
import type { SessionState } from "./session.ts";
import { Voice } from "./voice.ts";

export type Status = "idle" | "starting" | "running" | "error";

const IDLE_PERF: Perf = { fps: 0, frameMs: 0, variant: "full", frameStride: 1, slowDevice: false };

export function usePractice(pose: PoseDefinition, side: Side) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const voiceRef = useRef<Voice | null>(null);
  const recorderRef = useRef(new Recorder());

  /**
   * Whether a session should be running. This, not `status`, drives the effect:
   * the effect reports progress by setting `status`, so depending on `status`
   * would make it tear itself down the moment it announced it was running —
   * leaving the UI claiming "running" over a stopped camera.
   */
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [perf, setPerf] = useState<Perf>(IDLE_PERF);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedFrames, setRecordedFrames] = useState(0);

  const start = useCallback(() => {
    setError(null);
    // Browsers only allow speech after a gesture, so prime it from this click.
    voiceRef.current ??= new Voice();
    voiceRef.current.unlock();
    setStatus("starting");
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setStatus("idle");
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      voiceRef.current?.setMuted(!current);
      return !current;
    });
  }, []);

  const toggleRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder.recording) {
      const meta = {
        pose: pose.id,
        side,
        modelVariant: perf.variant,
        userAgent: navigator.userAgent,
      };
      downloadJson(recorder.suggestedFilename(meta), recorder.toJSON(meta));
      recorder.stop();
      setRecording(false);
    } else {
      recorder.start(performance.now());
      setRecordedFrames(0);
      setRecording(true);
    }
  }, [pose.id, side, perf.variant]);

  useEffect(() => {
    if (!active) return;

    let camera: CameraHandle | null = null;
    let runner: PracticeRunner | null = null;
    let cancelled = false;

    (async () => {
      const video = videoRef.current;
      if (!video) return;

      try {
        camera = await startCamera(video);
      } catch (cause) {
        if (cancelled) return;
        setError(cameraErrorMessage(cause));
        setStatus("error");
        setActive(false);
        return;
      }

      const voice = voiceRef.current ?? new Voice();
      voiceRef.current = voice;
      voice.setMuted(muted);

      runner = new PracticeRunner({
        video,
        canvas: () => canvasRef.current,
        pose,
        side,
        voice,
        recorder: recorderRef.current,
        onState: setState,
        onPerf: setPerf,
        onRecordedFrames: setRecordedFrames,
      });

      try {
        await runner.start();
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof Error
            ? `Could not load the pose model: ${cause.message}`
            : "Could not load the pose model.",
        );
        setStatus("error");
        setActive(false);
        camera.stop();
        return;
      }

      if (cancelled) {
        runner.stop();
        camera.stop();
        return;
      }
      setStatus("running");
    })();

    return () => {
      cancelled = true;
      runner?.stop();
      camera?.stop();
      voiceRef.current?.cancel();
      setState(null);
      setPerf(IDLE_PERF);
    };
    // Rebuilt deliberately when the pose or side changes; `muted` is read once at
    // startup and thereafter pushed straight to the Voice by toggleMuted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pose, side]);

  return {
    status,
    error,
    state,
    perf,
    muted,
    recording,
    recordedFrames,
    videoRef,
    canvasRef,
    start,
    stop,
    toggleRecording,
    toggleMuted,
  };
}
