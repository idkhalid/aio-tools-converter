import { describe, expect, it } from "vitest";
import { defaultOptions, validateOptions } from "./options";
import type { ToolOptionDefinition } from "./types";

const definitions: readonly ToolOptionDefinition[] = [
  { key: "quality", type: "range", label: "Quality", min: 1, max: 100, defaultValue: 90 },
  { key: "background", type: "color", label: "Background", defaultValue: "#ffffff" },
];

describe("option validation", () => {
  it("creates defaults", () => {
    expect(defaultOptions(definitions)).toEqual({ quality: 90, background: "#ffffff" });
  });

  it("reports invalid values without discarding other values", () => {
    const result = validateOptions(definitions, { quality: 120, background: "white" });
    expect(result.values).toEqual({ quality: 120, background: "white" });
    expect(result.errors).toEqual({
      quality: "Maximum is 100.",
      background: "Choose a valid color.",
    });
  });
});
