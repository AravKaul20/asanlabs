/** The one active cue, large enough to read from across a room. */
export function CueBanner({
  message,
  kind,
}: {
  message: string | null;
  kind: "cue" | "confirmation" | null;
}) {
  if (!message) return null;
  const confirming = kind === "confirmation";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4 sm:p-8">
      <p
        className={`max-w-3xl rounded-2xl px-6 py-4 text-center text-2xl font-semibold leading-snug backdrop-blur-sm sm:text-4xl ${
          confirming ? "bg-emerald-500/85 text-emerald-950" : "bg-red-500/85 text-white"
        }`}
      >
        {message}
      </p>
    </div>
  );
}
