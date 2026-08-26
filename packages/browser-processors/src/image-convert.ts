import { asExactArrayBuffer, dedupeFilenames, deriveOutputFilename } from "@aio-converter/shared";
import { ToolError } from "@aio-converter/tool-core";
import type { BufferProcessor } from "./protocol";

export const MAX_PIXELS = 40_000_000;

export function validatePNGDimensions(data: Uint8Array): void {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const hasHeader =
    data.byteLength >= 24 &&
    signature.every((value, index) => data[index] === value) &&
    String.fromCharCode(...data.subarray(12, 16)) === "IHDR";
  if (!hasHeader) {
    throw new ToolError("FILE_SIGNATURE", "A PNG file has an invalid header.");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) {
    throw new ToolError("FILE_SIGNATURE", "A PNG file has invalid dimensions.");
  }
  if (width > Math.floor(MAX_PIXELS / height)) {
    throw new ToolError(
      "FILE_TOO_LARGE",
      "An image has too many pixels to process safely in this browser.",
    );
  }
}

export const imageConvertProcessor: BufferProcessor = {
  async process(input, context) {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
      throw new ToolError(
        "BROWSER_UNSUPPORTED",
        "This browser cannot convert images in a worker. Try a current browser.",
        false,
      );
    }

    const preset = input.preset;
    if (!preset || preset.kind !== "image-convert") {
      throw new ToolError(
        "PROCESSING_FAILED",
        "The image processor is missing its registry preset.",
        false,
      );
    }

    const qualityValue = input.options.quality;
    const backgroundValue = input.options.background;
    const quality =
      typeof qualityValue === "number" && Number.isFinite(qualityValue)
        ? Math.min(100, Math.max(1, qualityValue)) / 100
        : 0.9;
    const background =
      typeof backgroundValue === "string" && /^#[0-9a-f]{6}$/i.test(backgroundValue)
        ? backgroundValue
        : "#ffffff";
    const names = dedupeFilenames(
      input.files.map((file) => deriveOutputFilename(file.name, preset.outputExtension)),
    );
    const outputs = [];

    for (const [index, file] of input.files.entries()) {
      if (context.signal.aborted) throw context.signal.reason;
      context.reportProgress({
        stage: "decoding",
        progress: index / input.files.length,
        message: `Decoding image ${index + 1} of ${input.files.length}`,
      });
      if (file.mimeType !== preset.inputMimeType) {
        throw new ToolError(
          "FILE_TYPE",
          `Expected ${preset.inputMimeType}, but received another type.`,
        );
      }
      if (preset.inputMimeType === "image/png") validatePNGDimensions(file.data);

      const source = new Blob([asExactArrayBuffer(file.data)], { type: preset.inputMimeType });
      const bitmap = await createImageBitmap(source);
      try {
        if (bitmap.width * bitmap.height > MAX_PIXELS) {
          throw new ToolError(
            "FILE_TOO_LARGE",
            "An image has too many pixels to process safely in this browser.",
          );
        }
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const drawingContext = canvas.getContext("2d", { alpha: !preset.flattenTransparency });
        if (!drawingContext) {
          throw new ToolError("BROWSER_UNSUPPORTED", "Canvas encoding is unavailable.", false);
        }
        if (preset.flattenTransparency) {
          drawingContext.fillStyle = background;
          drawingContext.fillRect(0, 0, bitmap.width, bitmap.height);
        }
        drawingContext.drawImage(bitmap, 0, 0);
        const encoded = await canvas.convertToBlob({ type: preset.outputMimeType, quality });
        if (encoded.type !== preset.outputMimeType || encoded.size === 0) {
          throw new ToolError("PROCESSING_FAILED", "The browser could not encode this image.");
        }
        outputs.push({
          name: names[index] ?? `converted-${index + 1}.${preset.outputExtension}`,
          mimeType: preset.outputMimeType,
          data: new Uint8Array(await encoded.arrayBuffer()),
        });
      } finally {
        bitmap.close();
      }
      context.reportProgress({
        stage: "encoding",
        progress: (index + 1) / input.files.length,
        message: `Converted image ${index + 1} of ${input.files.length}`,
      });
    }
    return outputs;
  },
};
