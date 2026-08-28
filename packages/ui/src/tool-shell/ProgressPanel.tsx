import type { ProcessProgress } from "@aio-converter/tool-core";
import { formatBytes } from "@aio-converter/shared";

export function ProgressPanel({
  progress,
  canceling,
  files,
  onCancel,
}: {
  progress: ProcessProgress | null;
  canceling: boolean;
  files: readonly File[];
  onCancel(): void;
}) {
  const value = progress?.progress;
  return (
    <section
      className="mt-8 overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white shadow-sm"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="border-b border-slate-100 p-6 pb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[1.125rem] font-semibold text-slate-950">
              {canceling ? "Canceling..." : "Converting your files..."}
            </h2>
            <p className="mt-1 text-sm text-slate-500 truncate">
              {canceling
                ? "Stopping the current job and cleaning up."
                : (progress?.message ?? "Working on your files...")}
            </p>
          </div>
          <span className="text-sm font-medium text-indigo-600">
            {typeof value === "number" ? `${Math.round(value * 100)}%` : ""}
          </span>
        </div>
        {typeof value === "number" ? (
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${Math.round(value * 100)}%` }}
            />
          </div>
        ) : (
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-1/3 animate-[pulse_2s_ease-in-out_infinite] bg-indigo-500" />
          </div>
        )}
      </div>

      <ol className="flex flex-col">
        {files.map((file, index) => (
          <li
            key={`${file.name}-${index}`}
            className={`flex items-center justify-between p-4 px-6 ${index > 0 ? "border-t border-slate-100" : ""}`}
          >
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex min-w-[2.5rem] items-center justify-center rounded-lg bg-indigo-50 px-2 py-1.5">
                <span className="text-[0.7rem] font-bold text-indigo-600">
                  {file.name.split(".").pop()?.toUpperCase() || "FILE"}
                </span>
              </div>
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium text-slate-900">{file.name}</span>
                <span className="text-[0.85rem] text-slate-500">
                  {file.name.split(".").pop()?.toUpperCase()} &middot; {formatBytes(file.size)}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2 pl-4 whitespace-nowrap">
              <span className="flex items-center gap-2 text-[0.85rem] text-indigo-500">
                <svg
                  className="h-4 w-4 animate-spin text-indigo-500"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                {canceling ? "Canceling..." : "Converting..."}
              </span>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex justify-end border-t border-slate-100 p-4 px-6">
        <button
          className="rounded-lg border border-slate-200 bg-white px-6 py-2 font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          type="button"
          disabled={canceling}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
