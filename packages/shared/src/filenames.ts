// eslint-disable-next-line no-control-regex -- Filename sanitization must remove the full C0 control range.
const UNSAFE_FILENAME = /[<>:"/\\|?*\u0000-\u001f]/g;
const TRAILING_DOTS_OR_SPACES = /[. ]+$/g;

export function sanitizeFilename(input: string, fallback = "converted-file"): string {
  const leaf = input.split(/[\\/]/).at(-1) ?? "";
  const safe = leaf
    .normalize("NFKC")
    .replace(UNSAFE_FILENAME, "-")
    .replace(/\s+/g, " ")
    .replace(TRAILING_DOTS_OR_SPACES, "")
    .trim()
    .slice(0, 180);
  return safe || fallback;
}

export function extensionOf(name: string): string {
  const safe = sanitizeFilename(name);
  const dot = safe.lastIndexOf(".");
  return dot > 0 ? safe.slice(dot + 1).toLowerCase() : "";
}

export function replaceExtension(name: string, extension: string): string {
  const safe = sanitizeFilename(name);
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const normalized = extension.replace(/^\.+/, "").toLowerCase();
  return `${stem || "converted-file"}.${normalized}`;
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
      candidate = `${stem}-${suffix}${extension}`;
      suffix += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
