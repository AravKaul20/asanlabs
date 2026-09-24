/** Plain-language setup fixes, shown before coaching starts. */
export function SetupNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-4">
      <p className="rounded-xl bg-amber-400/90 px-5 py-3 text-center text-lg font-medium text-amber-950 sm:text-xl">
        {message}
      </p>
    </div>
  );
}
