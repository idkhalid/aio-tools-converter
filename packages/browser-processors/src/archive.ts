import { dedupeFilenames, deriveConvertedArchiveFilename } from "@aio-converter/shared";
import { ToolError } from "@aio-converter/tool-core";
import type { BufferProcessor } from "./protocol";

export const archiveZipProcessor: BufferProcessor = {
  async process(input, context) {
    const { zipSync } = await import("fflate");
    if (context.signal.aborted) throw context.signal.reason;
    context.reportProgress({ stage: "packaging", progress: null, message: "Creating ZIP archive" });
    const names = dedupeFilenames(input.files.map((file) => file.name));
    const entries: Record<string, Uint8Array> = {};
    input.files.forEach((file, index) => {
      entries[names[index] ?? `file-${index + 1}`] = file.data;
    });
    const data = zipSync(entries, { level: 6 });
    if (data.byteLength === 0) throw new ToolError("PROCESSING_FAILED", "ZIP creation failed.");
    context.reportProgress({ stage: "complete", progress: 1, message: "ZIP archive ready" });
    const configuredSourceName = input.options.archiveSourceName;
    const sourceName =
      configuredSourceName === undefined
        ? (input.files[0]?.name ?? "")
        : typeof configuredSourceName === "string"
          ? configuredSourceName
          : "";
    return [
      {
        name: deriveConvertedArchiveFilename(sourceName),
        mimeType: "application/zip",
        data,
      },
    ];
  },
};
