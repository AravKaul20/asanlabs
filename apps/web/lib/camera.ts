/** Camera access. Video never leaves the device: there is nowhere for it to go. */

export interface CameraHandle {
  stream: MediaStream;
  stop(): void;
}

export async function startCamera(video: HTMLVideoElement): Promise<CameraHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot open a camera.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });

  video.srcObject = stream;
  await video.play();

  return {
    stream,
    stop() {
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}

/** Turn a getUserMedia rejection into something worth showing a person. */
export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") {
    return "Camera access was blocked. Allow it in your browser's address bar, then reload.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera found. Connect one and reload.";
  }
  if (name === "NotReadableError") {
    return "Your camera is in use by another app. Close it and reload.";
  }
  return error instanceof Error ? error.message : "Could not start the camera.";
}
