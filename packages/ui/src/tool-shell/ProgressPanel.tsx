import type { ProcessProgress } from "@aio-converter/tool-core";

export function ProgressPanel({
  progress,
  canceling,
  onCancel,
}: {
  progress: ProcessProgress | null;
  canceling: boolean;
  onCancel(): void;
}) {
  const value = progress?.progress;
  return (
    <section
      className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-5"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-slate-950">{canceling ? "Canceling" : "Processing"}</h2>
          <p className="mt-1 text-sm text-slate-700">
            {canceling
              ? "Stopping the current job and cleaning up."
              : (progress?.message ?? "Working on your files")}
          </p>
        </div>
        <button className="secondary-button" type="button" disabled={canceling} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {typeof value === "number" ? (
        <progress className="mt-4 h-2 w-full accent-sky-600" max={1} value={value}>
          {Math.round(value * 100)}%
        </progress>
      ) : (
        <progress className="mt-4 h-2 w-full accent-sky-600" max={1}>
          Processing
        </progress>
      )}
    </section>
  );
}
