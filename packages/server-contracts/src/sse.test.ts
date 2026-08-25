import { describe, expect, it } from "vitest";
import { extractSSEData, readSSE } from "./sse";

describe("SSE parser", () => {
  it("ignores comments and combines data lines", () => {
    expect(extractSSEData(': heartbeat\nevent: job\ndata: {"a":\ndata: 1}')).toBe('{"a":\n1}');
  });

  it("parses events split across network chunks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: job\ndata: one\n"));
        controller.enqueue(new TextEncoder().encode("\ndata: two\n\n"));
        controller.close();
      },
    });
    const events: string[] = [];
    for await (const event of readSSE(stream)) events.push(event);
    expect(events).toEqual(["one", "two"]);
  });
});
