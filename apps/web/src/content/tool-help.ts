export interface ToolHelp {
  intro: string;
  steps: readonly string[];
  limitations: readonly string[];
}

export const toolHelpById: Readonly<Record<string, ToolHelp>> = {
  "image.png-to-jpg": {
    intro:
      "PNG pixels are decoded and encoded as JPEG inside a disposable browser worker. Transparency is flattened because JPEG does not support an alpha channel.",
    steps: [
      "Choose one or more PNG images.",
      "Set JPEG quality and the color used behind transparent pixels.",
      "Process the queue, then download files individually or as a ZIP.",
    ],
    limitations: [
      "Images above 40 megapixels are rejected to reduce decompression-bomb and memory risk.",
      "JPEG is lossy, so very low quality settings can introduce visible artifacts.",
      "No server fallback is used when worker canvas encoding is unavailable.",
    ],
  },
  "image.jpg-to-png": {
    intro: "JPG pixels are decoded and encoded as PNG entirely inside a disposable browser worker.",
    steps: ["Choose one or more JPG images.", "Process the queue and download the PNG files."],
    limitations: [
      "Images above 40 megapixels are rejected.",
      "No server fallback is used.",
      "JPG source compression cannot be restored.",
    ],
  },
  "image.jpg-to-webp": {
    intro: "JPG pixels are converted to WebP locally in your browser.",
    steps: [
      "Choose one or more JPG images.",
      "Set WebP quality.",
      "Process and download the results.",
    ],
    limitations: [
      "Images above 40 megapixels are rejected.",
      "WebP quality is lossy.",
      "No server fallback is used.",
    ],
  },
  "image.png-to-webp": {
    intro:
      "PNG pixels are converted to WebP locally in your browser while preserving transparency.",
    steps: [
      "Choose one or more PNG images.",
      "Set WebP quality.",
      "Process and download the results.",
    ],
    limitations: [
      "Images above 40 megapixels are rejected.",
      "WebP quality is lossy.",
      "No server fallback is used.",
    ],
  },
  "image.jpg-to-ico": {
    intro: "JPG pixels are fitted into a valid multi-resolution ICO entirely in your browser.",
    steps: [
      "Choose one or more JPG images.",
      "Process the queue.",
      "Download ICO files containing 16–256px PNG entries.",
    ],
    limitations: [
      "Images above 40 megapixels are rejected.",
      "Non-square images use transparent contain padding.",
      "No server fallback is used.",
    ],
  },
  "image.png-to-ico": {
    intro:
      "PNG pixels are fitted into a valid multi-resolution ICO while preserving alpha where possible.",
    steps: [
      "Choose one or more PNG images.",
      "Process the queue.",
      "Download ICO files containing 16–256px PNG entries.",
    ],
    limitations: [
      "Images above 40 megapixels are rejected.",
      "Non-square images use contain padding.",
      "No server fallback is used.",
    ],
  },
  "image.heic-to-jpg": {
    intro:
      "HEIC photos are decoded with the bundled LGPL libheif WASM decoder and encoded as JPG locally.",
    steps: [
      "Choose one or more HEIC photos.",
      "Choose a background for transparent pixels.",
      "Process and download the JPG files.",
    ],
    limitations: [
      "Only the first top-level image is converted from multi-image HEIF files.",
      "Images above 40 megapixels are rejected.",
      "HEIC metadata is not retained.",
    ],
  },
  "image.heic-to-png": {
    intro:
      "HEIC photos are decoded with the bundled LGPL libheif WASM decoder and encoded as PNG locally.",
    steps: ["Choose one or more HEIC photos.", "Process the queue.", "Download the PNG files."],
    limitations: [
      "Only the first top-level image is converted from multi-image HEIF files.",
      "Images above 40 megapixels are rejected.",
      "HEIC metadata is not retained.",
    ],
  },
  "pdf.merge-pdf": {
    intro:
      "The selected PDFs are parsed and copied into a new document in the order shown in the queue, entirely inside a browser worker.",
    steps: [
      "Choose at least two PDF files.",
      "Use the arrow controls to arrange their order.",
      "Merge and download one new PDF containing the copied pages.",
    ],
    limitations: [
      "Encrypted, damaged, or unsupported PDFs are rejected rather than uploaded for repair.",
      "The merged output is limited to 1,000 pages in this first implementation.",
      "Interactive document features are preserved only to the extent supported by the PDF engine.",
    ],
  },
  "video.video-to-gif": {
    intro:
      "A lazy-loaded FFmpeg WebAssembly runtime decodes a short video and creates an animated GIF inside browser workers.",
    steps: [
      "Choose an MP4, WebM, or MOV video.",
      "Set the start time, clip duration, frame rate, and output width.",
      "Run the conversion and keep this tab open until the GIF is ready.",
    ],
    limitations: [
      "Clips are limited to 30 seconds and 960 pixels wide to bound browser memory use.",
      "GIF has a limited color palette and usually produces larger files than modern video formats.",
      "Performance depends on device memory and CPU; there is no silent server fallback.",
    ],
  },
  "document.docx-to-pdf": {
    intro:
      "The DOCX is streamed into a short-lived API job and converted by LibreOffice in a separate network-disabled container.",
    steps: [
      "Choose one valid DOCX document.",
      "Start the temporary server job and follow its real progress events.",
      "Download the one-time PDF output before the job expires.",
    ],
    limitations: [
      "Complex fonts, fields, macros, and application-specific layout may not match Microsoft Word exactly.",
      "Macro-enabled and malformed OOXML containers are rejected.",
      "Input is deleted after processing; output is deleted after download or within 15 minutes.",
    ],
  },
};
