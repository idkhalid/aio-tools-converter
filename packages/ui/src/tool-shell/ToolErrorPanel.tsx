import type { ToolError } from "@aio-converter/tool-core";
import { formatBytes } from "@aio-converter/shared";

export function ToolErrorPanel({
  error,
  files,
  onRetry,
}: {
  error: ToolError;
  files: readonly File[];
  onRetry(): void;
}) {
  return (
    <section
      ref={(node) => node?.focus()}
      tabIndex={-1}
      className="mt-8 overflow-hidden rounded-[1.25rem] border border-red-200 bg-white shadow-sm outline-none"
      role="alert"
    >
      <div className="border-b border-red-100 bg-red-50/50 p-6">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 text-yellow-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </div>
          <div>
            <h2 className="text-[1.05rem] font-semibold text-red-600">
              The job could not be finished
            </h2>
            <p className="mt-1 text-[0.9rem] text-slate-500">
              Your original files are unchanged. {error.message}
            </p>
          </div>
        </div>
      </div>

      {files.length > 0 && (
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
              <div className="flex items-center gap-3 pl-4 whitespace-nowrap">
                <span className="flex items-center gap-1.5 text-[0.85rem] font-medium text-red-600">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                  Failed
                </span>
                {error.recoverable && (
                  <button
                    className="text-[0.85rem] font-medium text-indigo-500 transition hover:text-indigo-600"
                    type="button"
                    onClick={onRetry}
                  >
                    Retry
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {(!files || files.length === 0) && error.recoverable && (
        <div className="p-4 px-6 border-t border-slate-100 flex justify-end">
          <button
            className="rounded-lg border border-slate-200 bg-white px-6 py-2 font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            type="button"
            onClick={onRetry}
          >
            Try again
          </button>
        </div>
      )}
    </section>
  );
}
