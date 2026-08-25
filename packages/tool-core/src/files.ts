import {
  extensionMatchesMime,
  mimeTypeForExtension,
  signatureMatches,
} from "@aio-converter/shared";
import type { ToolDefinition } from "./types";

export interface FileValidationIssue {
  code: "count" | "file-size" | "total-size" | "mime" | "extension" | "signature";
  message: string;
  fileIndex?: number;
}

function acceptedMimeForFile(file: File, accepts: readonly string[]): string | undefined {
  const declared = file.type.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  if (declared) return accepts.includes(declared) ? declared : undefined;
  const inferred = mimeTypeForExtension(file.name);
  return inferred && accepts.includes(inferred) ? inferred : undefined;
}

export async function validateFiles(
  tool: ToolDefinition,
  files: readonly File[],
): Promise<readonly FileValidationIssue[]> {
  const issues: FileValidationIssue[] = [];
  if (files.length < tool.minFiles || files.length > tool.maxFiles) {
    issues.push({
      code: "count",
      message: `Choose between ${tool.minFiles} and ${tool.maxFiles} files.`,
    });
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);
  const maxTotal = tool.maxTotalBytes ?? tool.maxInputBytes * tool.maxFiles;
  if (total > maxTotal) {
    issues.push({ code: "total-size", message: "The selected files exceed the total size limit." });
  }

  await Promise.all(
    files.map(async (file, fileIndex) => {
      if (file.size > tool.maxInputBytes) {
        issues.push({
          code: "file-size",
          fileIndex,
          message: `${file.name} exceeds the per-file size limit.`,
        });
      }

      const mime = acceptedMimeForFile(file, tool.accepts);
      if (!mime) {
        issues.push({
          code: "mime",
          fileIndex,
          message: `${file.name} is not a supported file type.`,
        });
        return;
      }

      if (extensionMatchesMime(file.name, mime) === false) {
        issues.push({
          code: "extension",
          fileIndex,
          message: `${file.name} has an extension that does not match its type.`,
        });
        return;
      }

      const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
      if (signatureMatches(mime, header) === false) {
        issues.push({
          code: "signature",
          fileIndex,
          message: `${file.name} does not contain a valid ${mime} signature.`,
        });
      }
    }),
  );

  return issues.sort((a, b) => (a.fileIndex ?? -1) - (b.fileIndex ?? -1));
}
