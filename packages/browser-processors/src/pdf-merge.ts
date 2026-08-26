import { deriveMergedPdfFilename } from "@aio-converter/shared";
import { ToolError } from "@aio-converter/tool-core";
import type { BufferProcessor } from "./protocol";

const MAX_PAGES = 1_000;

export const pdfMergeProcessor: BufferProcessor = {
  async process(input, context) {
    const { PDFDocument } = await import("pdf-lib");
    const output = await PDFDocument.create();
    let pageCount = 0;

    for (const [index, file] of input.files.entries()) {
      if (context.signal.aborted) throw context.signal.reason;
      context.reportProgress({
        stage: "reading-pdf",
        progress: index / input.files.length,
        message: `Reading PDF ${index + 1} of ${input.files.length}`,
      });
      try {
        const source = await PDFDocument.load(file.data, {
          ignoreEncryption: false,
          updateMetadata: false,
        });
        pageCount += source.getPageCount();
        if (pageCount > MAX_PAGES) {
          throw new ToolError(
            "FILE_TOO_LARGE",
            `The merged document is limited to ${MAX_PAGES} pages.`,
          );
        }
        const pages = await output.copyPages(source, source.getPageIndices());
        for (const page of pages) output.addPage(page);
      } catch (error: unknown) {
        if (error instanceof ToolError) throw error;
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        if (message.includes("encrypt")) {
          throw new ToolError(
            "ENCRYPTED_PDF",
            "An encrypted PDF cannot be merged. Unlock it first.",
          );
        }
        throw new ToolError(
          "PROCESSING_FAILED",
          "A PDF is damaged or uses features this browser processor cannot read.",
        );
      }
    }

    if (output.getPageCount() === 0) {
      throw new ToolError("PROCESSING_FAILED", "The selected PDFs contain no pages.");
    }
    context.reportProgress({ stage: "writing-pdf", progress: null, message: "Writing merged PDF" });
    const bytes = await output.save({ useObjectStreams: true });
    context.reportProgress({ stage: "complete", progress: 1, message: "PDF merged" });
    return [
      {
        name: deriveMergedPdfFilename(input.files.map((file) => file.name)),
        mimeType: "application/pdf",
        data: bytes,
      },
    ];
  },
};
