import type { ProcessorManifestEntry } from "@aio-converter/tool-core";

export const processorManifest = [
  { id: "image-convert", target: "browser" },
  { id: "pdf-merge", target: "browser" },
  { id: "ffmpeg-video-to-gif", target: "browser" },
  { id: "office-docx-to-pdf", target: "server" },
] as const satisfies readonly ProcessorManifestEntry[];
