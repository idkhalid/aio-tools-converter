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
});
