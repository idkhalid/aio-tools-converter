import { formatBytes } from "@aio-converter/shared";
import type { FileValidationIssue } from "@aio-converter/tool-core";
import { useRef } from "react";

interface FileQueueProps {
  files: readonly File[];
  issues: readonly FileValidationIssue[];
  disabled: boolean;
  reorderable: boolean;
  accepts: readonly string[];
  multiple: boolean;
  onFiles(files: readonly File[]): void;
  onRemove(index: number): void;
  onMove(index: number, direction: -1 | 1): void;
}

export function FileQueue({
  files,
  issues,
  disabled,
  reorderable,
  accepts,
  multiple,
  onFiles,
  onRemove,
  onMove,
}: FileQueueProps) {
  const input = useRef<HTMLInputElement>(null);

  if (files.length === 0 && issues.length === 0) return null;

  return (
    <section aria-labelledby="file-queue-heading" className="mt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="file-queue-heading" className="text-lg font-semibold text-slate-950">
            Files
          </h2>
          <span className="text-sm text-slate-500">
            {files.length} file{files.length !== 1 && "s"} &middot;{" "}
            {formatBytes(files.reduce((acc, f) => acc + f.size, 0))}
          </span>
        </div>
        <button
          type="button"
          disabled={disabled || (!multiple && files.length > 0)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          onClick={() => input.current?.click()}
        >
          <span>+</span> Add{multiple ? " files" : ""}
        </button>
        <input
          ref={input}
          className="sr-only"
          type="file"
          tabIndex={-1}
          accept={accepts.join(",")}
          multiple={multiple}
          disabled={disabled}
          onChange={(event) => {
            if (event.currentTarget.files) onFiles([...event.currentTarget.files]);
            event.currentTarget.value = "";
          }}
        />
      </div>
      <ol className="mt-4 overflow-hidden rounded-[1rem] border border-slate-200 bg-white">
        {files.map((file, index) => {
          const fileIssues = issues.filter((issue) => issue.fileIndex === index);
          return (
            <li
              key={`${file.name}-${file.lastModified}-${index}`}
              className={`flex flex-col p-4 ${index > 0 ? "border-t border-slate-100" : ""}`}
            >
              <div className="flex items-center gap-4">
                {reorderable && (
                  <span className="text-sm font-medium text-slate-400 min-w-[1rem] text-center">
                    {index + 1}
                  </span>
                )}
                <div className="flex items-center justify-center rounded-lg bg-indigo-50 px-2 py-1.5 min-w-[2.5rem]">
                  <span className="text-[0.7rem] font-bold text-indigo-600">
                    {file.name.split(".").pop()?.toUpperCase() || "FILE"}
                  </span>
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">{file.name}</span>
                  <span className="text-[0.85rem] text-slate-500">
                    {file.name.split(".").pop()?.toUpperCase()} &middot; {formatBytes(file.size)}
                  </span>
                </span>
                {reorderable && (
                  <span className="flex gap-1">
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                      type="button"
                      disabled={disabled || index === 0}
                      onClick={() => onMove(index, -1)}
                      aria-label={`Move ${file.name} up`}
                    >
                      &uarr;
                    </button>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
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
                  className="flex h-8 w-8 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(index)}
                  aria-label={`Remove ${file.name}`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              {fileIssues.map((issue) => (
                <p key={`${issue.code}-${issue.message}`} className="mt-2 text-sm text-red-600">
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
          <p key={`${issue.code}-${issue.message}`} className="mt-3 text-sm text-red-600">
            {issue.message}
          </p>
        ))}
    </section>
  );
}
