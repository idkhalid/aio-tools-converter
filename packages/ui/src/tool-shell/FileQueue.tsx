import { formatBytes } from "@aio-converter/shared";
import type { FileValidationIssue } from "@aio-converter/tool-core";

interface FileQueueProps {
  files: readonly File[];
  issues: readonly FileValidationIssue[];
  disabled: boolean;
  reorderable: boolean;
  onRemove(index: number): void;
  onMove(index: number, direction: -1 | 1): void;
}

export function FileQueue({
  files,
  issues,
  disabled,
  reorderable,
  onRemove,
  onMove,
}: FileQueueProps) {
  if (files.length === 0 && issues.length === 0) return null;
  return (
    <section aria-labelledby="file-queue-heading" className="mt-6">
      <div className="flex items-center justify-between gap-4">
        <h2 id="file-queue-heading" className="font-semibold text-slate-950">
          Selected files
        </h2>
        <span className="text-sm text-slate-600">{files.length} selected</span>
      </div>
      <ol className="mt-3 space-y-2">
        {files.map((file, index) => {
          const fileIssues = issues.filter((issue) => issue.fileIndex === index);
          return (
            <li
              key={`${file.name}-${file.lastModified}-${index}`}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">{file.name}</span>
                  <span className="text-sm text-slate-500">{formatBytes(file.size)}</span>
                </span>
                {reorderable && (
                  <span className="flex gap-1">
                    <button
                      className="icon-button"
                      type="button"
                      disabled={disabled || index === 0}
                      onClick={() => onMove(index, -1)}
                      aria-label={`Move ${file.name} up`}
                    >
                      &uarr;
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      disabled={disabled || index === files.length - 1}
                      onClick={() => onMove(index, 1)}
                      aria-label={`Move ${file.name} down`}
                    >
                      &darr;
                    </button>
                  </span>
                )}
                <button
                  className="icon-button"
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(index)}
                  aria-label={`Remove ${file.name}`}
                >
                  &times;
                </button>
              </div>
              {fileIssues.map((issue) => (
                <p key={`${issue.code}-${issue.message}`} className="mt-2 text-sm text-red-700">
                  {issue.message}
                </p>
              ))}
            </li>
          );
        })}
      </ol>
      {issues
        .filter((issue) => issue.fileIndex === undefined)
        .map((issue) => (
          <p key={`${issue.code}-${issue.message}`} className="mt-2 text-sm text-red-700">
            {issue.message}
          </p>
        ))}
    </section>
  );
}
