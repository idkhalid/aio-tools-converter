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
      className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"
      aria-live="polite"
    >
      <h2 className="text-lg font-semibold text-emerald-950">Your files are ready</h2>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li
            key={item.name}
            className="flex items-center justify-between gap-4 rounded-xl bg-white p-3"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.name}</span>
              <span className="text-sm text-slate-500">{formatBytes(item.size)}</span>
            </span>
            <a className="primary-button" href={item.url} download={item.name}>
              Download
            </a>
          </li>
        ))}
      </ul>
      {outputs.length > 1 &&
        archiveExecutor &&
        (packaging ? (
          <button
            className="secondary-button mt-4"
            type="button"
            onClick={() => archiveController.current?.abort()}
          >
            Cancel ZIP
          </button>
        ) : (
          <button
            className="primary-button mt-4"
            type="button"
            onClick={() => void downloadArchive()}
          >
            Download all as ZIP
          </button>
        ))}
      {archiveError && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {archiveError}
        </p>
      )}
      <button className="secondary-button mt-4 sm:ml-3" type="button" onClick={onReset}>
        Start over
      </button>
    </section>
  );
}
