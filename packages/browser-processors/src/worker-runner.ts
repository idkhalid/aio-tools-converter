import {
  ToolError,
  canceledError,
  type JobExecutor,
  type ProcessContext,
  type ProcessInput,
  type ProcessOutput,
  type ProcessorPreset,
} from "@aio-converter/tool-core";
import type { WorkerRequest, WorkerResponse } from "./protocol";

export interface WorkerJobExecutorOptions {
  createWorker: () => Worker;
  timeoutMs: number;
  processorPreset?: ProcessorPreset;
}

export class WorkerJobExecutor implements JobExecutor {
  readonly #createWorker: () => Worker;
  readonly #timeoutMs: number;
  readonly #processorPreset: ProcessorPreset | undefined;

  constructor(options: WorkerJobExecutorOptions) {
    this.#createWorker = options.createWorker;
    this.#timeoutMs = options.timeoutMs;
    this.#processorPreset = options.processorPreset;
  }

  execute(input: ProcessInput, context: ProcessContext): Promise<readonly ProcessOutput[]> {
    if (context.signal.aborted) return Promise.reject(canceledError());

    const worker = this.#createWorker();
    const jobId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        context.signal.removeEventListener("abort", cancel);
        worker.terminate();
        callback();
      };
      const cancel = (): void => {
        try {
          worker.postMessage({ type: "cancel", jobId } satisfies WorkerRequest);
        } finally {
          finish(() => reject(canceledError()));
        }
      };
      const timeout = setTimeout(() => {
        finish(() => reject(new ToolError("TIMEOUT", "Processing took too long and was stopped.")));
      }, this.#timeoutMs);

      context.signal.addEventListener("abort", cancel, { once: true });
      worker.onerror = () => {
        finish(() =>
          reject(
            new ToolError(
              "PROCESSING_FAILED",
              "The browser processor stopped unexpectedly. Try a smaller file.",
            ),
          ),
        );
      };
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.jobId !== jobId) return;
        if (message.type === "progress") {
          context.reportProgress(message.update);
          return;
        }
        if (message.type === "error") {
          finish(() =>
            reject(
              new ToolError(message.error.code, message.error.message, message.error.recoverable),
            ),
          );
          return;
        }
        finish(() =>
          resolve(
            message.outputs.map((output) => ({
              name: output.name,
              mimeType: output.mimeType,
              size: output.size,
              blob: new Blob([output.data], { type: output.mimeType }),
              ...(output.metadata ? { metadata: output.metadata } : {}),
            })),
          ),
        );
      };

      if (context.signal.aborted) {
        cancel();
        return;
      }

      void (async () => {
        try {
          worker.postMessage({
            type: "init",
            jobId,
            options: input.options,
            ...(this.#processorPreset ? { preset: this.#processorPreset } : {}),
          } satisfies WorkerRequest);
          for (const file of input.files) {
            if (context.signal.aborted) throw canceledError();
            const data = await file.arrayBuffer();
            const message = {
              type: "file",
              jobId,
              name: file.name,
              mimeType: file.type,
              lastModified: file.lastModified,
              data,
            } satisfies WorkerRequest;
            worker.postMessage(message, [data]);
          }
          worker.postMessage({ type: "run", jobId } satisfies WorkerRequest);
        } catch (error: unknown) {
          finish(() => reject(error));
        }
      })();
    });
  }
}
