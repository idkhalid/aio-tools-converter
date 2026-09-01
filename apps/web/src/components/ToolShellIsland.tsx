import { WorkerJobExecutor, MainThreadImageExecutor } from "@aio-converter/browser-processors";
import { ServerJobExecutor } from "@aio-converter/server-contracts";
import { MIME_EXTENSIONS } from "@aio-converter/shared";
import type { JobExecutor, ToolDefinition } from "@aio-converter/tool-core";
import { ToolShell } from "@aio-converter/ui";
import { useMemo } from "react";
import { appConfig } from "../lib/app-config";

function localExecutor(tool: ToolDefinition): JobExecutor {
  const timeoutMs = tool.timeoutMs ?? 120_000;
  const workerOptions = {
    timeoutMs,
    ...(tool.processorPreset ? { processorPreset: tool.processorPreset } : {}),
  };
  switch (tool.processor) {
    case "image-convert":
      // WebKit's worker ImageBitmap decoder is unreliable for JPEG blobs;
      // keep those conversions local while using the same canvas pipeline on
      // the main thread. PNG and HEIC continue to use the worker when available.
      if (
        tool.processorPreset?.inputMimeType === "image/jpeg" ||
        tool.processorPreset?.outputMimeType === "image/webp"
      ) {
        return new MainThreadImageExecutor(workerOptions);
      }
      if (
        typeof OffscreenCanvas !== "undefined" &&
        typeof OffscreenCanvas.prototype.convertToBlob === "function"
      ) {
        return new WorkerJobExecutor({
          ...workerOptions,
          createWorker: () =>
            new Worker(new URL("../workers/image-convert.worker.ts", import.meta.url), {
              type: "module",
              name: "image-convert",
            }),
        });
      }
      return new MainThreadImageExecutor(workerOptions);
    case "pdf-merge":
      return new WorkerJobExecutor({
        ...workerOptions,
        createWorker: () =>
          new Worker(new URL("../workers/pdf-merge.worker.ts", import.meta.url), {
            type: "module",
            name: "pdf-merge",
          }),
      });
    case "ffmpeg-video-to-gif":
      return new WorkerJobExecutor({
        ...workerOptions,
        createWorker: () =>
          new Worker(new URL("../workers/video-to-gif.worker.ts", import.meta.url), {
            type: "module",
            name: "video-to-gif",
          }),
      });
    default:
      throw new Error(`No browser executor is registered for ${tool.processor}`);
  }
}

function toolExecutor(tool: ToolDefinition): JobExecutor {
  if (tool.execution === "LOCAL_ONLY") return localExecutor(tool);
  if (tool.execution === "SERVER_EPHEMERAL") {
    const outputMimeType = tool.outputs[0];
    const outputExtension = outputMimeType
      ? MIME_EXTENSIONS[outputMimeType.toLowerCase()]?.[0]
      : undefined;
    if (!outputExtension) {
      throw new Error(`No output filename extension is registered for ${tool.id}.`);
    }
    return new ServerJobExecutor({
      apiBaseURL: appConfig.apiURL,
      toolId: tool.id,
      timeoutMs: tool.timeoutMs ?? 10 * 60_000,
      outputExtension,
    });
  }
  throw new Error("REMOTE_FETCH tools are not part of Phase 1.");
}

function archiveExecutor(): JobExecutor {
  return new WorkerJobExecutor({
    timeoutMs: 120_000,
    createWorker: () =>
      new Worker(new URL("../workers/archive.worker.ts", import.meta.url), {
        type: "module",
        name: "archive-zip",
      }),
  });
}

export function ToolShellIsland({ tool }: { tool: ToolDefinition }) {
  const executor = useMemo(() => toolExecutor(tool), [tool]);
  const archive = useMemo(archiveExecutor, []);
  return <ToolShell tool={tool} executor={executor} archiveExecutor={archive} />;
}
