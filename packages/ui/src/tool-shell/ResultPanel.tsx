import { formatBytes } from "@aio-converter/shared";
import { useEffect, useRef, useState } from "react";
import type { JobExecutor, ProcessOutput } from "@aio-converter/tool-core";

interface DownloadItem extends ProcessOutput {
  url: string;
}

export function ResultPanel({
  outputs,
  archiveExecutor,
  archiveSourceName,
  onReset,
}: {
  outputs: readonly ProcessOutput[];
  archiveExecutor?: JobExecutor;
  archiveSourceName?: string;
  onReset(): void;
}) {
  const [items, setItems] = useState<readonly DownloadItem[]>([]);
  const [packaging, setPackaging] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const archiveController = useRef<AbortController | null>(null);

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
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

  return (
    <section
      className="mt-8 overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      aria-live="polite"
    >
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
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
        <h2 className="text-[1.35rem] font-bold text-slate-950">Your files are ready</h2>
        <p className="mt-1 text-[0.95rem] text-slate-500">
          {outputs.length} file{outputs.length !== 1 ? "s" : ""} converted successfully
        </p>
      </div>

      {outputs.length > 1 && archiveExecutor && (
        <div className="mt-8">
          {packaging ? (
            <button
              className="w-full flex items-center justify-center gap-2 rounded-[1rem] bg-indigo-100 py-3.5 text-[1.05rem] font-medium text-indigo-700 transition-colors hover:bg-indigo-200"
              type="button"
              onClick={() => archiveController.current?.abort()}
            >
              <svg
                className="h-5 w-5 animate-spin"
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
              Cancel ZIP
            </button>
          ) : (
            <button
              className="w-full rounded-[1rem] bg-indigo-500 py-3.5 text-[1.05rem] font-medium text-white shadow-md transition-colors hover:bg-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              type="button"
              onClick={() => void downloadArchive()}
            >
              Download all (.zip)
            </button>
          )}
          {archiveError && (
            <p className="mt-3 text-center text-sm text-red-600" role="alert">
              {archiveError}
            </p>
          )}
        </div>
      )}

      <ul className={`mt-8 space-y-3 ${outputs.length === 1 ? "mt-8" : "mt-6"}`}>
        {items.map((item) => (
          <li
            key={item.name}
            className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-3 px-4 shadow-sm"
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

      <div className="mt-8 flex justify-center">
        <button
          className="rounded-xl border border-slate-200 bg-white px-8 py-3 font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          type="button"
          onClick={onReset}
        >
          Convert more files
        </button>
      </div>
    </section>
  );
}
