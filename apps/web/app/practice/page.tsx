"use client";

import { useMemo, useState } from "react";
import type { Side } from "@asan/core";
import { POSES, getPose, mountain } from "@asan/poses";
import { CueBanner } from "../../components/CueBanner.tsx";
import { DebugPanel } from "../../components/DebugPanel.tsx";
import { PosePicker } from "../../components/PosePicker.tsx";
import { SetupNotice } from "../../components/SetupNotice.tsx";
import { StatsBar } from "../../components/StatsBar.tsx";
import { poseUsesSides } from "../../lib/session.ts";
import { usePractice } from "../../lib/usePractice.ts";

export default function PracticePage() {
  const [poseId, setPoseId] = useState(mountain.id);
  const [side, setSide] = useState<Side>("right");

  const pose = useMemo(() => getPose(poseId) ?? mountain, [poseId]);
  const showSide = poseUsesSides(pose);

  const practice = usePractice(pose, side);
  const { state, perf, status } = practice;
  const running = status === "running" || status === "starting";

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Practice</h1>
          <p className="text-sm text-slate-400">
            Everything runs on your device. No video leaves this page.
          </p>
        </div>
        <p className="text-xs text-slate-500">Not a medical product.</p>
      </header>

      <PosePicker
        poses={POSES}
        selected={pose}
        side={side}
        showSide={showSide}
        disabled={running}
        onSelectPose={setPoseId}
        onSelectSide={setSide}
      />

      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-slate-700/60 bg-black">
        {/* Mirrored so the user sees themselves as in a mirror. */}
        <video
          ref={practice.videoRef}
          className="h-full w-full -scale-x-100 object-cover"
          playsInline
          muted
        />
        <canvas
          ref={practice.canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />

        {status === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/70 p-6 text-center">
            <p className="text-lg text-slate-300">
              Prop your phone or laptop so your whole body is in frame, a few metres away.
            </p>
            <button
              type="button"
              onClick={practice.start}
              className="rounded-xl bg-slate-100 px-6 py-3 text-base font-semibold text-slate-900 hover:bg-white"
            >
              Start camera
            </button>
          </div>
        )}

        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70">
            <p className="text-slate-300">Starting camera and loading the pose model…</p>
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/80 p-6 text-center">
            <p className="max-w-md text-red-300">{practice.error}</p>
            <button
              type="button"
              onClick={practice.start}
              className="rounded-xl bg-slate-100 px-5 py-2 font-medium text-slate-900"
            >
              Try again
            </button>
          </div>
        )}

        {status === "running" && (
          <>
            <SetupNotice message={state?.setup.message ?? null} />
            <CueBanner message={state?.message ?? null} kind={state?.messageKind ?? null} />
          </>
        )}
      </div>

      <StatsBar
        holdSeconds={state?.holdSeconds ?? 0}
        score={state?.score ?? 0}
        settled={state?.settled ?? false}
      />

      <div className="flex flex-wrap items-center gap-2">
        {status === "running" && (
          <button
            type="button"
            onClick={practice.stop}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700"
          >
            Stop
          </button>
        )}
        <button
          type="button"
          onClick={practice.toggleMuted}
          disabled={status !== "running"}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
        >
          {practice.muted ? "Unmute voice" : "Mute voice"}
        </button>
        <button
          type="button"
          onClick={practice.toggleRecording}
          disabled={status !== "running"}
          className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40 ${
            practice.recording
              ? "bg-red-500 text-white hover:bg-red-400"
              : "bg-slate-800 hover:bg-slate-700"
          }`}
        >
          {practice.recording
            ? `Stop and download (${practice.recordedFrames} frames)`
            : "Record landmarks"}
        </button>
        <p className="text-xs text-slate-500">
          Recording saves landmark coordinates only, as a JSON download. Never video.
        </p>
      </div>

      <DebugPanel
        perf={perf}
        ruleStates={state?.ruleStates ?? []}
        meanVelocity={state?.meanVelocity ?? 0}
        missing={state?.setup.missing ?? []}
      />
    </main>
  );
}
