import { asExactArrayBuffer } from "@aio-converter/shared";
import { canceledError, toToolError, type ProcessorPreset } from "@aio-converter/tool-core";
import type { BufferFile, BufferProcessor, WorkerRequest, WorkerResponse } from "./protocol";

interface WorkerEndpoint {
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}

interface ActiveWorkerJob {
  id: string;
  options: Readonly<Record<string, unknown>>;
  preset?: ProcessorPreset;
  files: BufferFile[];
  controller: AbortController;
  running: boolean;
}

export function installProcessorWorker(processor: BufferProcessor): void {
  const endpoint = globalThis as unknown as WorkerEndpoint;
  let active: ActiveWorkerJob | undefined;

  endpoint.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "init") {
      active?.controller.abort();
      active = {
        id: message.jobId,
        options: message.options,
        ...(message.preset ? { preset: message.preset } : {}),
        files: [],
        controller: new AbortController(),
        running: false,
      };
      return;
    }

    if (!active || active.id !== message.jobId) return;

    if (message.type === "file" && !active.running) {
      active.files.push({
        name: message.name,
        mimeType: message.mimeType,
        lastModified: message.lastModified,
        data: new Uint8Array(message.data),
      });
      return;
    }

    if (message.type === "cancel") {
      active.controller.abort(canceledError());
      return;
    }

    if (message.type === "run" && !active.running) {
      active.running = true;
      const job = active;
      void processor
        .process(
          {
            files: job.files,
            options: job.options,
            ...(job.preset ? { preset: job.preset } : {}),
          },
          {
            signal: job.controller.signal,
            reportProgress(update) {
              if (job.controller.signal.aborted) return;
              endpoint.postMessage({ type: "progress", jobId: job.id, update });
            },
          },
        )
        .then((outputs) => {
          if (job.controller.signal.aborted) throw canceledError();
          const transfer: Transferable[] = [];
          const serialized = outputs.map((output) => {
            const data = asExactArrayBuffer(output.data);
            transfer.push(data);
            return {
              name: output.name,
              mimeType: output.mimeType,
              size: data.byteLength,
              data,
            };
          });
          endpoint.postMessage({ type: "result", jobId: job.id, outputs: serialized }, transfer);
        })
        .catch((error: unknown) => {
          endpoint.postMessage({
            type: "error",
            jobId: job.id,
            error: toToolError(error).serialize(),
          });
        })
        .finally(() => {
          job.files.length = 0;
          if (active?.id === job.id) active = undefined;
        });
    }
  });
}
