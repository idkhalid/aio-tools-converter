import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { pdfMergeProcessor } from "./pdf-merge";

async function fixture(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) document.addPage([100, 100]);
  return document.save();
}

describe("PDF merge processor", () => {
  it("preserves all pages and returns a readable PDF", async () => {
    const outputs = await pdfMergeProcessor.process(
      {
        files: [
          {
            name: "Surat Edaran 17 Agustus 2025.pdf",
            mimeType: "application/pdf",
            lastModified: 0,
            data: await fixture(1),
          },
          { name: "two.pdf", mimeType: "application/pdf", lastModified: 0, data: await fixture(2) },
        ],
        options: {},
      },
      { signal: new AbortController().signal, reportProgress() {} },
    );
    const output = outputs[0];
    expect(output?.mimeType).toBe("application/pdf");
    expect(output?.name).toBe("Surat Edaran 17 Agustus 2025-merged.pdf");
    const reopened = await PDFDocument.load(output?.data ?? new Uint8Array());
    expect(reopened.getPageCount()).toBe(3);
  });

  it("uses the merge fallback when the first input name is invalid", async () => {
    const outputs = await pdfMergeProcessor.process(
      {
        files: [
          { name: "\u0000", mimeType: "application/pdf", lastModified: 0, data: await fixture(1) },
          {
            name: "Lampiran.pdf",
            mimeType: "application/pdf",
            lastModified: 0,
            data: await fixture(1),
          },
        ],
        options: {},
      },
      { signal: new AbortController().signal, reportProgress() {} },
    );

    expect(outputs[0]?.name).toBe("merged.pdf");
  });
});
