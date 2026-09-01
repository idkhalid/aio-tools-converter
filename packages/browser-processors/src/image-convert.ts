import {
  asExactArrayBuffer,
  dedupeFilenames,
  deriveOutputFilename,
  mimeTypeForExtension,
} from "@aio-converter/shared";
import { ToolError } from "@aio-converter/tool-core";
import type { BufferProcessor } from "./protocol";
import { decodeHeic } from "./heic";
import { buildIco, ICO_SIZES } from "./ico";

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
    if (typeof OffscreenCanvas === "undefined") {
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
      const fileMimeType = file.mimeType || mimeTypeForExtension(file.name);
      if (fileMimeType !== preset.inputMimeType) {
        throw new ToolError(
          "FILE_TYPE",
          `Expected ${preset.inputMimeType}, but received another type.`,
        );
      }
      if (preset.inputMimeType === "image/png") validatePNGDimensions(file.data);

      const heic =
        preset.inputMimeType === "image/heic" ? await decodeHeic(file.data, MAX_PIXELS) : undefined;
      if (!heic && typeof createImageBitmap !== "function") {
        throw new ToolError(
          "BROWSER_UNSUPPORTED",
          "This browser cannot decode images in a worker. Try a current browser.",
          false,
        );
      }
      const source = heic
        ? undefined
        : new Blob([asExactArrayBuffer(file.data)], { type: preset.inputMimeType });
      const bitmap = source ? await createImageBitmap(source) : undefined;
      try {
        const width = heic?.width ?? bitmap?.width ?? 0;
        const height = heic?.height ?? bitmap?.height ?? 0;
        if (width * height > MAX_PIXELS) {
          throw new ToolError(
            "FILE_TOO_LARGE",
            "An image has too many pixels to process safely in this browser.",
          );
        }
        const renderPng = async (size: number): Promise<Uint8Array> => {
          const canvas = new OffscreenCanvas(size, size);
          const drawingContext = canvas.getContext("2d", { alpha: true });
          if (!drawingContext)
            throw new ToolError("BROWSER_UNSUPPORTED", "Canvas encoding is unavailable.", false);
          drawingContext.clearRect(0, 0, size, size);
          const scale = Math.min(size / width, size / height);
          const drawWidth = Math.max(1, Math.round(width * scale));
          const drawHeight = Math.max(1, Math.round(height * scale));
          const x = Math.floor((size - drawWidth) / 2);
          const y = Math.floor((size - drawHeight) / 2);
          if (preset.flattenTransparency) {
            drawingContext.fillStyle = background;
            drawingContext.fillRect(0, 0, size, size);
          }
          if (heic) {
            const imageData = new ImageData(
              heic.data as unknown as Uint8ClampedArray<ArrayBuffer>,
              width,
              height,
            );
            drawingContext.putImageData(imageData, 0, 0);
            if (drawWidth !== width || drawHeight !== height) {
              const temp = new OffscreenCanvas(width, height);
              const tempContext = temp.getContext("2d");
              if (!tempContext)
                throw new ToolError(
                  "BROWSER_UNSUPPORTED",
                  "Canvas encoding is unavailable.",
                  false,
                );
              tempContext.putImageData(imageData, 0, 0);
              drawingContext.clearRect(0, 0, size, size);
              if (preset.flattenTransparency) {
                drawingContext.fillStyle = background;
                drawingContext.fillRect(0, 0, size, size);
              }
              drawingContext.drawImage(temp, x, y, drawWidth, drawHeight);
            }
          } else if (bitmap) {
            drawingContext.drawImage(bitmap, x, y, drawWidth, drawHeight);
          }
          const encoded = await canvas.convertToBlob({ type: "image/png" });
          if (encoded.type !== "image/png" || encoded.size === 0)
            throw new ToolError("PROCESSING_FAILED", "The browser could not encode this image.");
          return new Uint8Array(await encoded.arrayBuffer());
        };
        let encoded: Blob | Uint8Array;
        if (preset.outputMimeType === "image/x-icon") {
          const iconImages: Uint8Array[] = [];
          for (const size of ICO_SIZES) {
            if (context.signal.aborted) throw context.signal.reason;
            iconImages.push(await renderPng(size));
          }
          encoded = buildIco(iconImages);
        } else {
          const canvas = new OffscreenCanvas(width, height);
          const drawingContext = canvas.getContext("2d", { alpha: !preset.flattenTransparency });
          if (!drawingContext)
            throw new ToolError("BROWSER_UNSUPPORTED", "Canvas encoding is unavailable.", false);
          if (preset.flattenTransparency) {
            drawingContext.fillStyle = background;
            drawingContext.fillRect(0, 0, width, height);
          }
          if (heic)
            drawingContext.putImageData(
              new ImageData(heic.data as unknown as Uint8ClampedArray<ArrayBuffer>, width, height),
              0,
              0,
            );
          else if (bitmap) drawingContext.drawImage(bitmap, 0, 0);
          const outputBlob = await canvas.convertToBlob({ type: preset.outputMimeType, quality });
          if (outputBlob.type !== preset.outputMimeType || outputBlob.size === 0)
            throw new ToolError("PROCESSING_FAILED", "The browser could not encode this image.");
          encoded = outputBlob;
        }
        outputs.push({
          name: names[index] ?? `converted-${index + 1}.${preset.outputExtension}`,
          mimeType: preset.outputMimeType,
          data: encoded instanceof Blob ? new Uint8Array(await encoded.arrayBuffer()) : encoded,
        });
      } finally {
        bitmap?.close();
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
