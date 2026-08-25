import { describe, expect, it } from "vitest";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { WorkerJobExecutor } from "./worker-runner";

class FakeWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  readonly messages: WorkerRequest[] = [];
  terminateCalls = 0;
  respondOnRun = false;

  postMessage(message: WorkerRequest): void {
    this.messages.push(message);
    if (message.type === "run" && this.respondOnRun) {
      const bytes = new Uint8Array([255, 216, 255, 217]);
      queueMicrotask(() => {
        this.onmessage?.(
          new MessageEvent("message", {
            data: {
              type: "result",
              jobId: message.jobId,
              outputs: [
                {
                  name: "output.jpg",
                  mimeType: "image/jpeg",
                  size: bytes.byteLength,
                  data: bytes.buffer,
                },
              ],
            },
          }),
        );
      });
    }
  }

  terminate(): void {
    this.terminateCalls += 1;
  }
}

function input() {
  return {
    files: [new File([new Uint8Array([137, 80, 78, 71])], "input.png", { type: "image/png" })],
    options: {},
  };
}

describe("WorkerJobExecutor lifecycle", () => {
  it("transfers a result and always terminates a successful worker", async () => {
    const worker = new FakeWorker();
    worker.respondOnRun = true;
    const executor = new WorkerJobExecutor({
      createWorker: () => worker as unknown as Worker,
      timeoutMs: 1_000,
    });

    const outputs = await executor.execute(input(), {
      signal: new AbortController().signal,
      reportProgress() {},
    });

    expect(outputs[0]?.name).toBe("output.jpg");
    expect(outputs[0]?.blob.type).toBe("image/jpeg");
    expect(worker.messages.map((message) => message.type)).toEqual(["init", "file", "run"]);
    expect(worker.terminateCalls).toBe(1);
  });

  it("terminates and returns a typed cancellation error", async () => {
    const worker = new FakeWorker();
    const executor = new WorkerJobExecutor({
      createWorker: () => worker as unknown as Worker,
      timeoutMs: 1_000,
    });
    const controller = new AbortController();
    const result = executor.execute(input(), {
      signal: controller.signal,
      reportProgress() {},
    });
    controller.abort();

    await expect(result).rejects.toMatchObject({ code: "CANCELED" });
    expect(worker.terminateCalls).toBe(1);
  });

  it("terminates a worker after the configured timeout", async () => {
    const worker = new FakeWorker();
    const executor = new WorkerJobExecutor({
      createWorker: () => worker as unknown as Worker,
      timeoutMs: 5,
    });

    await expect(
      executor.execute(input(), {
        signal: new AbortController().signal,
        reportProgress() {},
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(worker.terminateCalls).toBe(1);
  });
});
