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
  maxInputBytes: number;
  maxTotalBytes: number;
  onFiles(files: readonly File[]): void;
  onReplace(index: number, files: readonly File[]): void;
  onRemove(index: number): void;
  onMove(index: number, direction: -1 | 1): void;
}

type FileInputIntent = { kind: "add" } | { kind: "replace"; index: number };

function isUnsupportedIssue(issue: FileValidationIssue): boolean {
  return issue.code === "mime" || issue.code === "extension" || issue.code === "signature";
}

export function FileQueue({
  files,
  issues,
  disabled,
  reorderable,
  accepts,
  multiple,
  maxInputBytes,
  maxTotalBytes,
  onFiles,
  onReplace,
  onRemove,
  onMove,
}: FileQueueProps) {
  const input = useRef<HTMLInputElement>(null);
  const inputIntent = useRef<FileInputIntent>({ kind: "add" });

  if (files.length === 0 && issues.length === 0) return null;

  const oversizedIssue = issues.find((issue) => issue.code === "file-size");
  const totalSizeIssue = issues.find((issue) => issue.code === "total-size");
  const unsupportedIssue = issues.find(isUnsupportedIssue);
  const edgeKind =
    oversizedIssue || totalSizeIssue ? "too-large" : unsupportedIssue ? "unsupported" : null;
  const oversizedFile =
    oversizedIssue?.fileIndex === undefined ? undefined : files[oversizedIssue.fileIndex];
  const selectedBytes = oversizedFile?.size ?? files.reduce((total, file) => total + file.size, 0);
  const limitBytes = oversizedFile ? maxInputBytes : maxTotalBytes;
  const largestFileIndex = files.reduce(
    (largest, file, index) => (file.size > (files[largest]?.size ?? -1) ? index : largest),
    0,
  );

  const openInput = (intent: FileInputIntent): void => {
    inputIntent.current = intent;
    input.current?.click();
  };

  return (
    <section aria-labelledby="file-queue-heading" className="mt-6">
      {edgeKind && (
        <div
          className={`mb-6 rounded-[1.25rem] border p-5 sm:p-6 ${
            edgeKind === "unsupported"
              ? "border-red-200 bg-red-50/50"
              : "border-amber-200 bg-amber-50/50"
          }`}
          role="alert"
        >
          <div className="flex items-start gap-4">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl font-bold ${
                edgeKind === "unsupported"
                  ? "bg-red-100 text-red-600"
                  : "bg-amber-100 text-amber-600"
              }`}
              aria-hidden="true"
            >
              {edgeKind === "unsupported" ? "!" : "\u2191"}
            </span>
            <div className="min-w-0">
              <h2 className="text-[1.2rem] font-bold text-slate-950">
                {edgeKind === "unsupported" ? "Unsupported file type" : "File is too large"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {edgeKind === "unsupported"
                  ? "Remove the unsupported file and choose another file in a supported format."
                  : "The selected file exceeds this converter's current limit. Upload a smaller file to continue."}
              </p>
            </div>
          </div>
          {edgeKind === "too-large" && (
            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-amber-200 bg-white/80 px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Selected
                </dt>
                <dd className="mt-1 font-semibold text-slate-950">{formatBytes(selectedBytes)}</dd>
              </div>
              <div className="rounded-xl border border-amber-200 bg-white/80 px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Limit
                </dt>
                <dd className="mt-1 font-semibold text-slate-950">{formatBytes(limitBytes)}</dd>
              </div>
            </dl>
          )}
          {totalSizeIssue && oversizedIssue === undefined && (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                className="rounded-xl bg-indigo-500 px-5 py-2.5 font-medium text-white shadow-sm transition hover:bg-indigo-600"
                onClick={() => openInput({ kind: "replace", index: largestFileIndex })}
              >
                Upload smaller file
              </button>
              <button
                type="button"
                className="rounded-xl border border-red-200 bg-red-50 px-5 py-2.5 font-medium text-red-700 transition hover:bg-red-100"
                onClick={() => onRemove(largestFileIndex)}
              >
                Remove file
              </button>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="file-queue-heading" className="text-lg font-semibold text-slate-950">
            Files
          </h2>
          <span className="absolute opacity-0 pointer-events-none -z-10">
            {files.length} selected
          </span>
          <div className="text-sm text-slate-500">
            {files.length} file{files.length !== 1 && "s"} &middot;{" "}
            {formatBytes(files.reduce((acc, f) => acc + f.size, 0))}
          </div>
        </div>
        <button
          type="button"
          disabled={disabled || (!multiple && files.length > 0)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          onClick={() => openInput({ kind: "add" })}
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
            if (event.currentTarget.files) {
              const selected = [...event.currentTarget.files];
              const intent = inputIntent.current;
              if (intent.kind === "replace") onReplace(intent.index, selected);
              else onFiles(selected);
            }
            inputIntent.current = { kind: "add" };
            event.currentTarget.value = "";
          }}
        />
      </div>
      <ol className="mt-4 overflow-hidden rounded-[1rem] border border-slate-200 bg-white">
        {files.map((file, index) => {
          const fileIssues = issues.filter((issue) => issue.fileIndex === index);
          const unsupported = fileIssues.some(isUnsupportedIssue);
          const tooLarge = fileIssues.some((issue) => issue.code === "file-size");
          const hasEdgeIssue = unsupported || tooLarge;
          return (
            <li
              key={`${file.name}-${file.lastModified}-${index}`}
              className={`flex flex-col p-4 ${index > 0 ? "border-t border-slate-100" : ""} ${
                unsupported ? "bg-red-50/40" : tooLarge ? "bg-amber-50/40" : ""
              }`}
            >
              <div
                className={`flex items-center gap-4 ${hasEdgeIssue ? "flex-wrap sm:flex-nowrap" : ""}`}
              >
                {reorderable && (
                  <span className="text-sm font-medium text-slate-400 min-w-[1rem] text-center">
                    {index + 1}
                  </span>
                )}
                <div
                  className={`flex items-center justify-center rounded-lg px-2 py-1.5 min-w-[2.5rem] ${
                    unsupported ? "bg-red-100" : tooLarge ? "bg-amber-100" : "bg-indigo-50"
                  }`}
                >
                  <span
                    className={`text-[0.7rem] font-bold ${
                      unsupported ? "text-red-600" : tooLarge ? "text-amber-700" : "text-indigo-600"
                    }`}
                  >
                    {file.name.split(".").pop()?.toUpperCase() || "FILE"}
                  </span>
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">{file.name}</span>
                  <span
                    className={`text-[0.85rem] ${
                      unsupported
                        ? "font-medium text-red-600"
                        : tooLarge
                          ? "font-medium text-amber-700"
                          : "text-slate-500"
                    }`}
                  >
                    {unsupported
                      ? "Unsupported format"
                      : tooLarge
                        ? `${formatBytes(file.size)} selected \u00b7 ${formatBytes(maxInputBytes)} limit`
                        : `${file.name.split(".").pop()?.toUpperCase()} \u00b7 ${formatBytes(file.size)}`}
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
                {hasEdgeIssue ? (
                  <span className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
                    <button
                      className="flex-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50 sm:flex-none"
                      type="button"
                      disabled={disabled}
                      onClick={() => onRemove(index)}
                    >
                      Remove file
                    </button>
                    <button
                      className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 sm:flex-none"
                      type="button"
                      disabled={disabled}
                      onClick={() => openInput({ kind: "replace", index })}
                    >
                      {tooLarge ? "Upload smaller file" : "Choose another file"}
                    </button>
                  </span>
                ) : (
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
                )}
              </div>
              {!hasEdgeIssue &&
                fileIssues.map((issue) => (
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
