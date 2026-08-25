import { describe, expect, it } from "vitest";
import { ToolError, toToolError } from "./errors";

describe("safe error mapping", () => {
  it("preserves typed user-safe errors", () => {
    const error = new ToolError("FILE_TYPE", "Choose a PNG file.");
    expect(toToolError(error)).toBe(error);
  });

  it("does not expose unknown internal error details", () => {
    const mapped = toToolError(new Error("secret stack and filename"));
    expect(mapped.code).toBe("PROCESSING_FAILED");
    expect(mapped.message).not.toContain("secret");
  });
});
