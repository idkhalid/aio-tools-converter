import { describe, expect, it } from "vitest";
import { ToolError, type ToolDefinition } from "@aio-converter/tool-core";
import { createInitialToolShellState, toolShellReducer } from "./state";

const tool: ToolDefinition = {
  id: "image.test",
  slug: "test",
  category: "image",
  title: "Test",
  shortDescription: "Test",
  execution: "LOCAL_ONLY",
  processor: "test",
  accepts: ["image/png"],
  outputs: ["image/jpeg"],
  minFiles: 1,
  maxFiles: 1,
  maxInputBytes: 100,
  options: [],
  seo: { title: "Test", description: "Test", canonicalPath: "/image/test" },
  status: "active",
};

describe("ToolShell reducer", () => {
  it("retains files after processing errors", () => {
    const file = new File([new Uint8Array([1])], "test.png", { type: "image/png" });
    let state = createInitialToolShellState(tool);
    state = toolShellReducer(state, { type: "files-set", files: [file] });
    state = toolShellReducer(state, { type: "started", runId: 1 });
    state = toolShellReducer(state, {
      type: "failed",
      runId: 1,
      error: new ToolError("PROCESSING_FAILED", "Failed"),
    });
    expect(state.phase).toBe("error");
    expect(state.files).toEqual([file]);
  });

  it("ignores late messages from an older worker", () => {
    let state = createInitialToolShellState(tool);
    state = toolShellReducer(state, { type: "started", runId: 2 });
    const unchanged = toolShellReducer(state, {
      type: "failed",
      runId: 1,
      error: new ToolError("PROCESSING_FAILED", "Old failure"),
    });
    expect(unchanged).toBe(state);
  });

  it("returns to the file-ready state when preflight validation rejects a run", () => {
    const file = new File([new Uint8Array([1])], "test.png", { type: "image/png" });
    let state = createInitialToolShellState(tool);
    state = toolShellReducer(state, { type: "files-set", files: [file] });
    state = toolShellReducer(state, { type: "started", runId: 3 });
    state = toolShellReducer(state, { type: "validation-rejected", runId: 3 });

    expect(state.phase).toBe("ready");
    expect(state.runId).toBeNull();
    expect(state.files).toEqual([file]);
  });

  it("keeps selected files in a persistent cancelled state", () => {
    const file = new File([new Uint8Array([1])], "test.png", { type: "image/png" });
    let state = createInitialToolShellState(tool);
    state = toolShellReducer(state, { type: "files-set", files: [file] });
    state = toolShellReducer(state, { type: "started", runId: 4 });
    state = toolShellReducer(state, { type: "cancel-requested", runId: 4 });
    state = toolShellReducer(state, { type: "canceled", runId: 4 });

    expect(state.phase).toBe("canceled");
    expect(state.files).toEqual([file]);
    expect(state.runId).toBeNull();
  });

  it("represents a successful run with no downloadable output", () => {
    let state = createInitialToolShellState(tool);
    state = toolShellReducer(state, { type: "started", runId: 5 });
    state = toolShellReducer(state, { type: "empty-result", runId: 5 });

    expect(state.phase).toBe("empty");
    expect(state.outputs).toEqual([]);
    expect(state.error).toBeNull();
  });

  it("ignores stale empty and cancelled events", () => {
    let state = createInitialToolShellState(tool);
    state = toolShellReducer(state, { type: "started", runId: 7 });

    expect(toolShellReducer(state, { type: "empty-result", runId: 6 })).toBe(state);
    expect(toolShellReducer(state, { type: "canceled", runId: 6 })).toBe(state);
  });

  it("retains successful outputs and failed inputs after partial success", () => {
    const failedFile = new File([new Uint8Array([1])], "failed.png", {
      type: "image/png",
    });
    const output = {
      name: "ready.jpg",
      mimeType: "image/jpeg",
      size: 1,
      blob: new Blob([new Uint8Array([1])], { type: "image/jpeg" }),
    };
    let state = createInitialToolShellState(tool);
    state = toolShellReducer(state, { type: "started", runId: 6 });
    state = toolShellReducer(state, {
      type: "partially-succeeded",
      runId: 6,
      outputs: [output],
      failedFiles: [failedFile],
    });

    expect(state.phase).toBe("partial-success");
    expect(state.outputs).toEqual([output]);
    expect(state.failedFiles).toEqual([failedFile]);
  });

  it("keeps successful downloads available when a partial retry fails", () => {
    const failedFile = new File([new Uint8Array([1])], "failed.png", {
      type: "image/png",
    });
    const output = {
      name: "ready.jpg",
      mimeType: "image/jpeg",
      size: 1,
      blob: new Blob([new Uint8Array([1])], { type: "image/jpeg" }),
    };
    const error = new ToolError("PROCESSING_FAILED", "Still failed");
    let state = createInitialToolShellState(tool);
    state = toolShellReducer(state, { type: "started", runId: 8 });
    state = toolShellReducer(state, {
      type: "partial-failed",
      runId: 8,
      outputs: [output],
      failedFiles: [failedFile],
      error,
    });

    expect(state.phase).toBe("partial-success");
    expect(state.outputs).toEqual([output]);
    expect(state.failedFiles).toEqual([failedFile]);
    expect(state.error).toBe(error);
  });
});
