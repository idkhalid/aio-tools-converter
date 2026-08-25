import { describe, expect, it } from "vitest";
import { validateFiles } from "./files";
import type { ToolDefinition } from "./types";

const pngTool: ToolDefinition = {
  id: "image.png-test",
  slug: "png-test",
  category: "image",
  title: "PNG test",
  shortDescription: "PNG test",
  execution: "LOCAL_ONLY",
  processor: "image-convert",
  accepts: ["image/png"],
  outputs: ["image/jpeg"],
  minFiles: 1,
  maxFiles: 1,
  maxInputBytes: 1024,
  options: [],
  seo: {
    title: "PNG test",
    description: "PNG test",
    canonicalPath: "/image/png-test",
  },
  status: "active",
};

const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

describe("file validation", () => {
  it("accepts a valid signature and an inferred MIME when the browser omits it", async () => {
    const file = new File([pngSignature], "pixel.png");
    await expect(validateFiles(pngTool, [file])).resolves.toEqual([]);
  });

  it("rejects a non-empty declared MIME that conflicts with the tool", async () => {
    const file = new File([pngSignature], "pixel.png", { type: "image/jpeg" });
    const issues = await validateFiles(pngTool, [file]);
    expect(issues.map((issue) => issue.code)).toContain("mime");
  });

  it("rejects a forged PNG signature", async () => {
    const file = new File([new Uint8Array([0, 1, 2, 3])], "pixel.png", {
      type: "image/png",
    });
    const issues = await validateFiles(pngTool, [file]);
    expect(issues.map((issue) => issue.code)).toContain("signature");
  });
});
