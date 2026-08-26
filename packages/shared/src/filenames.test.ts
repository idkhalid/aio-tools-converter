import { describe, expect, it } from "vitest";
import {
  MAX_FILENAME_LENGTH,
  dedupeFilenames,
  deriveConvertedArchiveFilename,
  deriveMergedPdfFilename,
  deriveOutputFilename,
  getBaseName,
  replaceExtension,
  sanitizeDownloadFilename,
  sanitizeFilename,
} from "./filenames";

describe("filename helpers", () => {
  it("removes path traversal and reserved characters", () => {
    expect(sanitizeFilename("../../bad:<name>.png")).toBe("bad--name-.png");
    expect(sanitizeDownloadFilename("file\u0000\u0085 name.pdf")).toBe("file name.pdf");
    expect(sanitizeDownloadFilename("../secret.docx")).toBe("secret.docx");
  });

  it("replaces extensions and de-duplicates names", () => {
    expect(replaceExtension("photo.PNG", "jpg")).toBe("photo.jpg");
    expect(dedupeFilenames(["photo.jpg", "photo.jpg", "PHOTO.jpg"])).toEqual([
      "photo.jpg",
      "photo-2.jpg",
      "PHOTO-3.jpg",
    ]);
  });

  it.each([
    ["Surat Edaran 17 Agustus 2025.docx", "pdf", "Surat Edaran 17 Agustus 2025.pdf"],
    ["photo.png", "jpg", "photo.jpg"],
    ["video.mp4", "gif", "video.gif"],
    ["archive.final.docx", "pdf", "archive.final.pdf"],
    ["image.profile.final.png", "jpg", "image.profile.final.jpg"],
    ["video.final.cut.mp4", "gif", "video.final.cut.gif"],
    ["../secret.docx", "pdf", "secret.pdf"],
    ["", "pdf", "converted.pdf"],
    [".docx", "pdf", "converted.pdf"],
    ["\u0000\u001f\u0085", "pdf", "converted.pdf"],
  ])("derives %s as a safe output name", (input, extension, expected) => {
    expect(deriveOutputFilename(input, extension)).toBe(expected);
  });

  it("derives merge and archive names from only the first input basename", () => {
    expect(deriveMergedPdfFilename(["Surat Edaran 17 Agustus 2025.pdf", "Lampiran.pdf"])).toBe(
      "Surat Edaran 17 Agustus 2025-merged.pdf",
    );
    expect(deriveMergedPdfFilename(["", "Lampiran.pdf"])).toBe("merged.pdf");
    expect(deriveConvertedArchiveFilename("photo one.png")).toBe("photo one-converted.zip");
    expect(deriveConvertedArchiveFilename("\u0000")).toBe("converted-files.zip");
  });

  it("keeps generated names within the existing maximum length", () => {
    const longName = `${"surat".repeat(50)}.docx`;
    const longMultiDotBase = `archive.final.${"x".repeat(220)}`;
    const converted = deriveOutputFilename(longName, "pdf");
    const convertedMultiDot = deriveOutputFilename(`${longMultiDotBase}.docx`, "pdf");
    const merged = deriveMergedPdfFilename([longName]);
    const archive = deriveConvertedArchiveFilename(longName);

    expect(getBaseName("archive.final.docx")).toBe("archive.final");
    expect(converted.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
    expect(converted.endsWith(".pdf")).toBe(true);
    expect(convertedMultiDot).toBe(`${longMultiDotBase.slice(0, 176)}.pdf`);
    expect(merged.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
    expect(merged.endsWith("-merged.pdf")).toBe(true);
    expect(archive.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
    expect(archive.endsWith("-converted.zip")).toBe(true);
  });
});
