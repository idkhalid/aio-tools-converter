import { formatBytes } from "@aio-converter/shared";
import { useEffect, useRef, useState } from "react";
import type { JobExecutor, ProcessOutput } from "@aio-converter/tool-core";
import { MobileActionBar } from "./MobileActionBar";

interface DownloadItem extends ProcessOutput {
  url: string;
}

export function ResultPanel({
  outputs,
  archiveExecutor,
  archiveSourceName,
  failedFiles = [],
  retryError,
  onRetryFile,
  onReset,
}: {
  outputs: readonly ProcessOutput[];
  archiveExecutor?: JobExecutor;
  archiveSourceName?: string;
  failedFiles?: readonly File[];
  retryError?: string | null;
  onRetryFile?: (file: File) => void;
  onReset(): void;
}) {
  const [items, setItems] = useState<readonly DownloadItem[]>([]);
  const [packaging, setPackaging] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const archiveController = useRef<AbortController | null>(null);
  const partial = outputs.length > 0 && failedFiles.length > 0;

  useEffect(() => {
    const next = outputs.map((output) => ({ ...output, url: URL.createObjectURL(output.blob) }));
    setItems(next);
    return () => next.forEach((item) => URL.revokeObjectURL(item.url));
  }, [outputs]);

  useEffect(() => () => archiveController.current?.abort(), []);

  const downloadArchive = async (): Promise<void> => {
    if (!archiveExecutor) return;
    setPackaging(true);
    setArchiveError(null);
    const controller = new AbortController();
    archiveController.current = controller;
    try {
      const result = await archiveExecutor.execute(
        {
          files: outputs.map(
            (output) => new File([output.blob], output.name, { type: output.mimeType }),
          ),
          options: { archiveSourceName },
        },
        { signal: controller.signal, reportProgress() {} },
      );
      const archive = result[0];
      if (!archive) throw new Error("Archive output is missing");
      const url = URL.createObjectURL(archive.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = archive.name;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 60_000);
    } catch {
      if (!controller.signal.aborted) {
        setArchiveError(
          "The ZIP archive could not be created. Individual downloads are still available.",
        );
      }
    } finally {
      if (archiveController.current === controller) archiveController.current = null;
      setPackaging(false);
    }
  };

  const downloadSuccessfulFiles = async (): Promise<void> => {
    if (outputs.length > 1 && archiveExecutor) {
      await downloadArchive();
      return;
    }
    for (const item of items) {
      const link = document.createElement("a");
      link.href = item.url;
      link.download = item.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const primaryLabel = partial
    ? "Download successful files"
    : outputs.length > 1
      ? "Download all (.zip)"
      : "Download";
  const primaryAriaLabel = partial
    ? "Download successful files"
    : outputs.length > 1
      ? "Download all as ZIP"
      : "Download";
  const canDownload = outputs.length > 1 && archiveExecutor ? true : items.length > 0;

  const primaryDownloadButton = (compact = false) => (
    <button
      className={`rounded-xl font-medium shadow-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50 ${
        compact
          ? "bg-indigo-500 px-4 py-2.5 text-sm text-white hover:bg-indigo-600"
          : packaging
            ? "w-full bg-indigo-100 py-3.5 text-[1.05rem] text-indigo-700 hover:bg-indigo-200"
            : "w-full bg-indigo-500 py-3.5 text-[1.05rem] text-white hover:bg-indigo-600"
      }`}
      type="button"
      disabled={!canDownload}
      onClick={() => {
        if (packaging) archiveController.current?.abort();
        else void downloadSuccessfulFiles();
      }}
      aria-label={packaging ? "Cancel ZIP" : primaryAriaLabel}
    >
      {packaging ? "Cancel ZIP" : primaryLabel}
    </button>
  );

  return (
    <section
      className="mt-8 overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      aria-live="polite"
    >
      <div className="flex flex-col items-center text-center">
        <div
          className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full ${
            partial ? "bg-amber-50 text-amber-500" : "bg-emerald-50 text-emerald-500"
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <h2 className="text-[1.35rem] font-bold text-slate-950">
          {partial ? "Some files are ready" : "Your files are ready"}
        </h2>
        <p className="mt-1 text-[0.95rem] text-slate-500">
          {partial
            ? `${outputs.length} file${outputs.length !== 1 ? "s were" : " was"} converted successfully. ${failedFiles.length} file${failedFiles.length !== 1 ? "s" : ""} could not be converted.`
            : `${outputs.length} file${outputs.length !== 1 ? "s" : ""} converted successfully`}
        </p>
      </div>

      {partial && (
        <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
          <div className="flex items-center gap-4">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-xl font-bold text-emerald-600"
              aria-hidden="true"
            >
              &#10003;
            </span>
            <div>
              <h3 className="font-semibold text-slate-950">
                {outputs.length} of {outputs.length + failedFiles.length} files ready
              </h3>
              <p className="mt-1 text-sm text-slate-500">Download successful files now.</p>
            </div>
          </div>
        </div>
      )}

      {(partial || (outputs.length > 1 && archiveExecutor)) && (
        <div className="mt-6 hidden sm:block">
          {primaryDownloadButton()}
          {archiveError && (
            <p className="mt-3 text-center text-sm text-red-600" role="alert">
              {archiveError}
            </p>
          )}
        </div>
      )}

      {partial && (
        <div className="mt-8 flex items-center justify-between gap-4">
          <h3 className="font-semibold text-slate-950">Converted files</h3>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            {outputs.length} ready
          </span>
        </div>
      )}

      <ul className={`space-y-3 ${partial ? "mt-4" : outputs.length === 1 ? "mt-8" : "mt-6"}`}>
        {items.map((item) => (
          <li
            key={item.name}
            className={`flex items-center justify-between gap-4 rounded-xl border p-3 px-4 shadow-sm ${
              partial ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex min-w-[2.5rem] items-center justify-center rounded-lg bg-emerald-50 px-2 py-1.5">
                <span className="text-[0.7rem] font-bold text-emerald-600">
                  {item.name.split(".").pop()?.toUpperCase() || "FILE"}
                </span>
              </div>
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium text-slate-900">{item.name}</span>
                <span className="text-[0.85rem] text-slate-500">
                  {item.name.split(".").pop()?.toUpperCase()} &middot; {formatBytes(item.size)}
                </span>
                {item.metadata?.originalBytes !== undefined && (
                  <span className="block text-[0.75rem] text-slate-400">
                    {formatBytes(item.metadata.originalBytes)} → {formatBytes(item.size)}
                    {item.metadata.savedPercent !== undefined
                      ? ` · ${item.metadata.savedPercent}% smaller`
                      : ""}
                  </span>
                )}
              </span>
            </div>

            {outputs.length === 1 ? (
              <a
                className="rounded-lg bg-indigo-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-600"
                href={item.url}
                download={item.name}
              >
                Download
              </a>
            ) : (
              <a
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-indigo-500 transition hover:bg-indigo-50"
                href={item.url}
                download={item.name}
                title="Download"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              </a>
            )}
          </li>
        ))}
      </ul>

      {partial && (
        <div className="mt-8">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-semibold text-slate-950">Failed files</h3>
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
              {failedFiles.length} failed
            </span>
          </div>
          <ul className="mt-4 space-y-3">
            {failedFiles.map((file, index) => (
              <li
                key={`${file.name}-${file.lastModified}-${index}`}
                className="flex flex-col gap-4 rounded-xl border border-red-200 bg-red-50/40 p-4 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="flex min-w-[2.5rem] items-center justify-center rounded-lg bg-red-100 px-2 py-1.5">
                    <span className="text-[0.7rem] font-bold text-red-600">
                      {file.name.split(".").pop()?.toUpperCase() || "FILE"}
                    </span>
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{file.name}</span>
                    <span className="text-[0.85rem] font-medium text-red-600">
                      Could not be converted
                    </span>
                  </span>
                </div>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-indigo-600 shadow-sm transition hover:bg-indigo-50 disabled:opacity-50"
                  type="button"
                  disabled={!onRetryFile}
                  onClick={() => onRetryFile?.(file)}
                >
                  Retry
                </button>
              </li>
            ))}
          </ul>
          {retryError && (
            <p className="mt-3 text-sm text-red-600" role="alert">
              {retryError}
            </p>
          )}
        </div>
      )}

      {archiveError && (
        <p className="mt-4 text-center text-sm text-red-600 sm:hidden" role="alert">
          {archiveError}
        </p>
      )}

      <div className="mt-8 flex justify-center">
        <button
          className="rounded-xl border border-slate-200 bg-white px-8 py-3 font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          type="button"
          onClick={onReset}
        >
          Convert more files
        </button>
      </div>

      {canDownload && (
        <MobileActionBar
          title={partial ? `${outputs.length} successful` : `${outputs.length} ready`}
          description={partial ? `${failedFiles.length} failed` : "Ready to download"}
        >
          {primaryDownloadButton(true)}
        </MobileActionBar>
      )}
    </section>
  );
}
