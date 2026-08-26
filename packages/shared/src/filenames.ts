export const MAX_FILENAME_LENGTH = 180;

// eslint-disable-next-line no-control-regex -- Download names must not contain C0, DEL, or C1 controls.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const UNSAFE_FILENAME = /[<>:"|?*]/g;
const TRAILING_DOTS_OR_SPACES = /[. ]+$/g;

function truncateFilename(input: string, maximumLength: number): string {
  const truncated = input.slice(0, Math.max(0, maximumLength));
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1);
  return finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff ? truncated.slice(0, -1) : truncated;
}

function trimFilenameEnding(input: string): string {
  return input.replace(TRAILING_DOTS_OR_SPACES, "").trim();
}

function sanitizedLeaf(input: string, maximumLength?: number): string {
  const normalized = input.normalize("NFKC");
  const leaf = normalized.split(/[\\/]/).at(-1) ?? "";
  const cleaned = leaf
    .replace(CONTROL_CHARACTERS, "")
    .replace(UNSAFE_FILENAME, "-")
    .replace(/\s+/g, " ")
    .trim();
  return trimFilenameEnding(
    maximumLength === undefined ? cleaned : truncateFilename(cleaned, maximumLength),
  );
}

export function sanitizeDownloadFilename(input: string, fallback = ""): string {
  const safe = sanitizedLeaf(input, MAX_FILENAME_LENGTH);
  if (safe) return safe;

  if (fallback) {
    const safeFallback = sanitizeDownloadFilename(fallback);
    if (safeFallback) return safeFallback;
  }
  return "";
}

export function sanitizeFilename(input: string, fallback = "converted-file"): string {
  return sanitizeDownloadFilename(input, fallback) || "converted-file";
}

function normalizeExtension(extension: string): string {
  const normalized = extension
    .normalize("NFKC")
    .replace(CONTROL_CHARACTERS, "")
    .trim()
    .replace(/^\.+/, "")
    .toLowerCase();
  return /^[a-z0-9]+$/.test(normalized) ? normalized.slice(0, 16) : "bin";
}

function composeFilename(
  baseName: string,
  suffix: string,
  extension: string,
  fallback: string,
): string {
  if (!baseName) return fallback;
  const ending = `${suffix}.${extension}`;
  const truncatedBase = trimFilenameEnding(
    truncateFilename(baseName, MAX_FILENAME_LENGTH - ending.length),
  );
  return truncatedBase ? `${truncatedBase}${ending}` : fallback;
}

export function getBaseName(filename: string): string {
  const safe = sanitizedLeaf(filename);
  const dot = safe.lastIndexOf(".");
  if (dot === 0) return "";
  const baseName = trimFilenameEnding(dot > 0 ? safe.slice(0, dot) : safe);
  return trimFilenameEnding(truncateFilename(baseName, MAX_FILENAME_LENGTH));
}

export function deriveOutputFilename(inputName: string, outputExtension: string): string {
  const extension = normalizeExtension(outputExtension);
  return composeFilename(getBaseName(inputName), "", extension, `converted.${extension}`);
}

export function deriveMergedPdfFilename(inputNames: readonly string[]): string {
  return composeFilename(getBaseName(inputNames[0] ?? ""), "-merged", "pdf", "merged.pdf");
}

export function deriveConvertedArchiveFilename(inputName: string): string {
  return composeFilename(getBaseName(inputName), "-converted", "zip", "converted-files.zip");
}

export function extensionOf(name: string): string {
  const safe = sanitizedLeaf(name);
  const dot = safe.lastIndexOf(".");
  return dot > 0 ? safe.slice(dot + 1).toLowerCase() : "";
}

export function replaceExtension(name: string, extension: string): string {
  return deriveOutputFilename(name, extension);
}

export function dedupeFilenames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((rawName) => {
    const name = sanitizeFilename(rawName);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    let candidate = name;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) {
      const dedupeSuffix = `-${suffix}${extension}`;
      const truncatedStem = trimFilenameEnding(
        truncateFilename(stem, MAX_FILENAME_LENGTH - dedupeSuffix.length),
      );
      candidate = `${truncatedStem || "converted-file"}${dedupeSuffix}`;
      suffix += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
