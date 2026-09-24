import type { PoseDefinition, Side } from "@asan/core";

export function PosePicker({
  poses,
  selected,
  side,
  showSide,
  disabled,
  onSelectPose,
  onSelectSide,
}: {
  poses: readonly PoseDefinition[];
  selected: PoseDefinition;
  side: Side;
  showSide: boolean;
  disabled: boolean;
  onSelectPose: (id: string) => void;
  onSelectSide: (side: Side) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-2">
        {poses.map((pose) => (
          <button
            key={pose.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelectPose(pose.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-40 ${
              pose.id === selected.id
                ? "bg-slate-100 text-slate-900"
                : "bg-slate-800 text-slate-200 hover:bg-slate-700"
            }`}
          >
            {pose.name}
          </button>
        ))}
      </div>

      {showSide && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Front leg</span>
          {(["left", "right"] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => onSelectSide(option)}
              className={`rounded-lg px-3 py-2 text-sm capitalize transition disabled:opacity-40 ${
                option === side
                  ? "bg-slate-100 text-slate-900"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
