/**
 * Canvas skeleton overlay.
 *
 * Draws from image landmarks — the only thing they are for. All judgement runs on
 * world landmarks; these are just pixels.
 *
 * The video is mirrored so the user sees themselves as in a mirror, so the
 * overlay mirrors too. MediaPipe's left/right already refer to the subject's own
 * left and right, so mirroring the drawing does not change which joint is which.
 */
import { POSE_BONES, landmarkIndex, type Landmark, type LandmarkName } from "@asan/core";

export interface OverlayStyle {
  bone: string;
  joint: string;
  highlight: string;
  highlightGlow: string;
}

export const DEFAULT_STYLE: OverlayStyle = {
  bone: "rgba(226, 232, 240, 0.55)",
  joint: "rgba(226, 232, 240, 0.8)",
  highlight: "rgb(248, 113, 113)",
  highlightGlow: "rgba(248, 113, 113, 0.35)",
};

export interface DrawOptions {
  landmarks: readonly Landmark[];
  /** Joints to call attention to, from the active cue. */
  highlight?: readonly string[];
  mirror?: boolean;
  style?: OverlayStyle;
}

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  { landmarks, highlight = [], mirror = true, style = DEFAULT_STYLE }: DrawOptions,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (landmarks.length === 0) return;

  const highlighted = new Set(highlight);
  const at = (name: LandmarkName) => {
    const index = landmarkIndex(name);
    if (index === undefined) return null;
    const point = landmarks[index];
    if (!point || point.visibility < 0.5) return null;
    return { x: (mirror ? 1 - point.x : point.x) * width, y: point.y * height };
  };

  ctx.lineCap = "round";

  for (const [from, to] of POSE_BONES) {
    const a = at(from);
    const b = at(to);
    if (!a || !b) continue;
    const hot = highlighted.has(from) && highlighted.has(to);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = hot ? style.highlight : style.bone;
    ctx.lineWidth = hot ? 7 : 4;
    ctx.stroke();
  }

  for (const [name] of POSE_BONES.flatMap((bone) => [[bone[0]], [bone[1]]] as const)) {
    const point = at(name);
    if (!point) continue;
    const hot = highlighted.has(name);
    if (hot) {
      // A soft ring makes the cued joint findable at a glance from a few metres.
      ctx.beginPath();
      ctx.arc(point.x, point.y, 18, 0, Math.PI * 2);
      ctx.fillStyle = style.highlightGlow;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(point.x, point.y, hot ? 8 : 5, 0, Math.PI * 2);
    ctx.fillStyle = hot ? style.highlight : style.joint;
    ctx.fill();
  }
}

/** Keep the overlay's pixel grid matched to its on-screen size. */
export function sizeCanvasToVideo(canvas: HTMLCanvasElement, video: HTMLVideoElement): void {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width > 0 && height > 0 && (canvas.width !== width || canvas.height !== height)) {
    canvas.width = width;
    canvas.height = height;
  }
}
