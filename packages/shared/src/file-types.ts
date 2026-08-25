import { extensionOf } from "./filenames";

export const MIME_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "image/gif": ["gif"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "video/mp4": ["mp4", "m4v"],
  "video/quicktime": ["mov"],
  "video/webm": ["webm"],
};

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

export function signatureMatches(mimeType: string, bytes: Uint8Array): boolean | null {
  switch (mimeType.toLowerCase()) {
    case "image/png":
      return startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
    case "image/jpeg":
      return startsWith(bytes, [255, 216, 255]);
    case "image/webp":
      return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
    case "image/gif":
      return ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a";
    case "application/pdf":
      return ascii(bytes, 0, 5) === "%PDF-";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return (
        startsWith(bytes, [80, 75, 3, 4]) ||
        startsWith(bytes, [80, 75, 5, 6]) ||
        startsWith(bytes, [80, 75, 7, 8])
      );
    case "video/webm":
      return startsWith(bytes, [26, 69, 223, 163]);
    case "video/mp4":
    case "video/quicktime":
      return bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp";
    default:
      return null;
  }
}

export function extensionMatchesMime(name: string, mimeType: string): boolean | null {
  const extensions = MIME_EXTENSIONS[mimeType.toLowerCase()];
  if (!extensions) return null;
  return extensions.includes(extensionOf(name));
}

export function mimeTypeForExtension(name: string): string | undefined {
  const extension = extensionOf(name);
  return Object.entries(MIME_EXTENSIONS).find(([, extensions]) =>
    extensions.includes(extension),
  )?.[0];
}
