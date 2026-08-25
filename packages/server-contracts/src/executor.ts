import { sanitizeFilename } from "@aio-converter/shared";
import {
  ToolError,
  canceledError,
  type JobExecutor,
  type ProcessContext,
  type ProcessInput,
  type ProcessOutput,
} from "@aio-converter/tool-core";
import { readSSE } from "./sse";
import type { CreateJobResponse, ServerJobSnapshot } from "./types";

interface ServerJobExecutorOptions {
  apiBaseURL: string;
  toolId: string;
  timeoutMs: number;
}

interface APIErrorBody {
  error?: { code?: string; message?: string };
}

function endpoint(base: string, path: string): string {
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

async function responseError(response: Response): Promise<ToolError> {
  let body: APIErrorBody | undefined;
  try {
    body = (await response.json()) as APIErrorBody;
  } catch {
    body = undefined;
  }
  return new ToolError(
    response.status >= 500 ? "NETWORK_ERROR" : "SERVER_REJECTED",
    body?.error?.message ?? "The server could not accept this conversion job.",
  );
}

function terminal(snapshot: ServerJobSnapshot): boolean {
  return ["succeeded", "failed", "canceled", "timed_out"].includes(snapshot.status);
}

async function requestCleanup(apiBaseURL: string, jobId: string): Promise<void> {
  const cleanupController = new AbortController();
  const cleanupTimeout = setTimeout(() => cleanupController.abort(), 5_000);
  try {
    await fetch(endpoint(apiBaseURL, `/v1/jobs/${encodeURIComponent(jobId)}`), {
      method: "DELETE",
      cache: "no-store",
      credentials: "omit",
      signal: cleanupController.signal,
    });
  } catch {
    // The server-side process timeout and TTL remain the final cleanup guard.
  } finally {
    clearTimeout(cleanupTimeout);
  }
}

function filenameFromDisposition(value: string | null): string | undefined {
  if (!value) return undefined;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try {
      return sanitizeFilename(decodeURIComponent(encoded));
    } catch {
      return undefined;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(value)?.[1];
  return plain ? sanitizeFilename(plain) : undefined;
}

export class ServerJobExecutor implements JobExecutor {
  readonly #apiBaseURL: string;
  readonly #toolId: string;
  readonly #timeoutMs: number;

  constructor(options: ServerJobExecutorOptions) {
    this.#apiBaseURL = options.apiBaseURL;
    this.#toolId = options.toolId;
    this.#timeoutMs = options.timeoutMs;
  }

  async execute(input: ProcessInput, context: ProcessContext): Promise<readonly ProcessOutput[]> {
    const controller = new AbortController();
    let timedOut = false;
    let jobId: string | undefined;
    const cancel = (): void => controller.abort(context.signal.reason);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    context.signal.addEventListener("abort", cancel, { once: true });

    try {
      if (context.signal.aborted) throw canceledError();
      const form = new FormData();
      input.files.forEach((file) => form.append("file", file, file.name));
      form.append("options", JSON.stringify(input.options));
      context.reportProgress({ stage: "uploading", progress: null, message: "Uploading securely" });
      const createdResponse = await fetch(
        endpoint(this.#apiBaseURL, `/v1/jobs/${encodeURIComponent(this.#toolId)}`),
        {
          method: "POST",
          body: form,
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        },
      );
      if (!createdResponse.ok) throw await responseError(createdResponse);
      const created = (await createdResponse.json()) as CreateJobResponse;
      if (!created.jobId || !created.eventsUrl || !created.outputUrl) {
        throw new ToolError("NETWORK_ERROR", "The server returned an invalid job response.");
      }
      jobId = created.jobId;
      const eventsResponse = await fetch(endpoint(this.#apiBaseURL, created.eventsUrl), {
        headers: { Accept: "text/event-stream" },
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (!eventsResponse.ok || !eventsResponse.body) throw await responseError(eventsResponse);

      let finalSnapshot: ServerJobSnapshot | undefined;
      for await (const payload of readSSE(eventsResponse.body)) {
        const snapshot = JSON.parse(payload) as ServerJobSnapshot;
        context.reportProgress({
          stage: snapshot.progress.stage || snapshot.status,
          progress: snapshot.progress.progress,
          ...(snapshot.progress.message ? { message: snapshot.progress.message } : {}),
        });
        if (terminal(snapshot)) {
          finalSnapshot = snapshot;
          break;
        }
      }
      if (!finalSnapshot) {
        throw new ToolError("NETWORK_ERROR", "The progress stream ended before the job completed.");
      }
      if (finalSnapshot.status === "canceled") throw canceledError();
      if (finalSnapshot.status === "timed_out") {
        throw new ToolError("TIMEOUT", "The server job exceeded its processing limit.");
      }
      if (finalSnapshot.status === "failed") {
        throw new ToolError(
          "PROCESSING_FAILED",
          finalSnapshot.error?.message ?? "The document could not be converted.",
        );
      }

      context.reportProgress({
        stage: "downloading",
        progress: null,
        message: "Downloading result",
      });
      const outputResponse = await fetch(endpoint(this.#apiBaseURL, created.outputUrl), {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (!outputResponse.ok) throw await responseError(outputResponse);
      const blob = await outputResponse.blob();
      const name =
        filenameFromDisposition(outputResponse.headers.get("Content-Disposition")) ??
        finalSnapshot.output?.name ??
        "converted.pdf";
      const mimeType =
        outputResponse.headers.get("Content-Type")?.split(";", 1)[0] ||
        finalSnapshot.output?.mimeType ||
        "application/octet-stream";
      return [{ name: sanitizeFilename(name), mimeType, size: blob.size, blob }];
    } catch (error: unknown) {
      if (jobId) await requestCleanup(this.#apiBaseURL, jobId);
      if (timedOut)
        throw new ToolError("TIMEOUT", "The server job took too long and was canceled.");
      if (context.signal.aborted) throw canceledError();
      if (error instanceof ToolError) throw error;
      throw new ToolError("NETWORK_ERROR", "The server connection was interrupted. Try again.");
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener("abort", cancel);
    }
  }
}
