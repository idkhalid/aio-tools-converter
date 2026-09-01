import {
  asExactArrayBuffer,
  deriveOutputFilename,
  deriveOutputFilenameWithSuffix,
  mimeTypeForExtension,
} from "@aio-converter/shared";
import { ToolError, type ImageConvertProcessorPreset } from "@aio-converter/tool-core";
import type { BufferProcessor } from "./protocol";
import { decodeHeic } from "./heic";
import { buildIco, ICO_SIZES } from "./ico";

export const MAX_PIXELS = 40_000_000;

export interface RasterDimensions {
  width: number;
  height: number;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function calculateResizeDimensions(
  source: RasterDimensions,
  options: Readonly<Record<string, unknown>>,
): RasterDimensions {
  const lockAspectRatio = options.lockAspectRatio !== false;
  const width = options.width;
  const height = options.height;
  if (
    (width !== undefined && !finitePositive(width)) ||
    (height !== undefined && !finitePositive(height))
  ) {
    throw new ToolError("OPTION_INVALID", "Enter positive width and height values.");
  }
  if (!finitePositive(source.width) || !finitePositive(source.height)) {
    throw new ToolError("FILE_SIGNATURE", "The image has invalid dimensions.");
  }
  if (lockAspectRatio) {
    if (finitePositive(width)) {
      const targetWidth = Math.round(width);
      const targetHeight = Math.max(1, Math.round((targetWidth * source.height) / source.width));
      return { width: targetWidth, height: targetHeight };
    }
    if (finitePositive(height)) {
      const targetHeight = Math.round(height);
      const targetWidth = Math.max(1, Math.round((targetHeight * source.width) / source.height));
      return { width: targetWidth, height: targetHeight };
    }
  } else if (finitePositive(width) && finitePositive(height)) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  throw new ToolError("OPTION_INVALID", "Enter positive width and height values.");
}

export function outputExtensionForMime(mimeType: string): "jpg" | "png" | "webp" {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  return "webp";
}

export function operationForPreset(
  preset: ImageConvertProcessorPreset,
): "convert" | "compress" | "resize" {
  return preset.operation ?? "convert";
}

export function outputName(
  fileName: string,
  operation: "convert" | "compress" | "resize",
  extension: string,
  dimensions: RasterDimensions,
): string {
  if (operation === "compress") {
    return deriveOutputFilenameWithSuffix(fileName, "-compressed", extension);
  }
  if (operation === "resize") {
    return deriveOutputFilenameWithSuffix(
      fileName,
      `-${dimensions.width}x${dimensions.height}`,
      extension,
    );
  }
  return deriveOutputFilename(fileName, extension);
}

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
    const operation = operationForPreset(preset);
    const outputs = [];
    const usedNames = new Set<string>();
    const uniqueName = (candidate: string): string => {
      const dot = candidate.lastIndexOf(".");
      const stem = dot > 0 ? candidate.slice(0, dot) : candidate;
      const extension = dot > 0 ? candidate.slice(dot) : "";
      let next = candidate;
      let suffix = 2;
      while (usedNames.has(next.toLowerCase())) {
        next = `${stem}-${suffix}${extension}`;
        suffix += 1;
      }
      usedNames.add(next.toLowerCase());
      return next;
    };

    for (const [index, file] of input.files.entries()) {
      if (context.signal.aborted) throw context.signal.reason;
      context.reportProgress({
        stage: "decoding",
        progress: index / input.files.length,
        message: `Decoding image ${index + 1} of ${input.files.length}`,
      });
      const fileMimeType = file.mimeType || mimeTypeForExtension(file.name) || "";
      const acceptedMimeTypes: readonly string[] = preset.inputMimeTypes ?? [preset.inputMimeType];
      if (!acceptedMimeTypes.includes(fileMimeType)) {
        throw new ToolError(
          "FILE_TYPE",
          "This image format is not supported by the selected tool.",
        );
      }
      if (fileMimeType === "image/png") validatePNGDimensions(file.data);

      const heic =
        fileMimeType === "image/heic" ? await decodeHeic(file.data, MAX_PIXELS) : undefined;
      if (!heic && typeof createImageBitmap !== "function") {
        throw new ToolError(
          "BROWSER_UNSUPPORTED",
          "This browser cannot decode images in a worker. Try a current browser.",
          false,
        );
      }
      const source = heic
        ? undefined
        : new Blob([asExactArrayBuffer(file.data)], { type: fileMimeType });
      const bitmap = source ? await createImageBitmap(source) : undefined;
      try {
        const sourceDimensions = {
          width: heic?.width ?? bitmap?.width ?? 0,
          height: heic?.height ?? bitmap?.height ?? 0,
        };
        if (sourceDimensions.width * sourceDimensions.height > MAX_PIXELS) {
          throw new ToolError(
            "FILE_TOO_LARGE",
            "An image has too many pixels to process safely in this browser.",
          );
        }
        const dimensions =
          operation === "resize"
            ? calculateResizeDimensions(sourceDimensions, input.options)
            : sourceDimensions;
        if (dimensions.width * dimensions.height > MAX_PIXELS) {
          throw new ToolError(
            "FILE_TOO_LARGE",
            "The requested dimensions are too large to process safely in this browser.",
          );
        }
        const outputMimeType = operation === "convert" ? preset.outputMimeType : fileMimeType;
        const outputExtension =
          operation === "convert" ? preset.outputExtension : outputExtensionForMime(fileMimeType);
        const renderPng = async (size: number): Promise<Uint8Array> => {
          const canvas = new OffscreenCanvas(size, size);
          const drawingContext = canvas.getContext("2d", { alpha: true });
          if (!drawingContext)
            throw new ToolError("BROWSER_UNSUPPORTED", "Canvas encoding is unavailable.", false);
          drawingContext.imageSmoothingEnabled = true;
          drawingContext.imageSmoothingQuality = "high";
          drawingContext.clearRect(0, 0, size, size);
          const scale = Math.min(size / sourceDimensions.width, size / sourceDimensions.height);
          const drawWidth = Math.max(1, Math.round(sourceDimensions.width * scale));
          const drawHeight = Math.max(1, Math.round(sourceDimensions.height * scale));
          const x = Math.floor((size - drawWidth) / 2);
          const y = Math.floor((size - drawHeight) / 2);
          if (preset.flattenTransparency) {
            drawingContext.fillStyle = background;
            drawingContext.fillRect(0, 0, size, size);
          }
          if (heic) {
            const imageData = new ImageData(
              heic.data as unknown as Uint8ClampedArray<ArrayBuffer>,
              sourceDimensions.width,
              sourceDimensions.height,
            );
            drawingContext.putImageData(imageData, 0, 0);
            if (drawWidth !== sourceDimensions.width || drawHeight !== sourceDimensions.height) {
              const temp = new OffscreenCanvas(sourceDimensions.width, sourceDimensions.height);
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
          const canvas = new OffscreenCanvas(dimensions.width, dimensions.height);
          const drawingContext = canvas.getContext("2d", { alpha: !preset.flattenTransparency });
          if (!drawingContext)
            throw new ToolError("BROWSER_UNSUPPORTED", "Canvas encoding is unavailable.", false);
          drawingContext.imageSmoothingEnabled = true;
          drawingContext.imageSmoothingQuality = "high";
          if (preset.flattenTransparency) {
            drawingContext.fillStyle = background;
            drawingContext.fillRect(0, 0, dimensions.width, dimensions.height);
          }
          if (heic)
            drawingContext.putImageData(
              new ImageData(
                heic.data as unknown as Uint8ClampedArray<ArrayBuffer>,
                sourceDimensions.width,
                sourceDimensions.height,
              ),
              0,
              0,
            );
          else if (bitmap)
            drawingContext.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
          const outputBlob = await canvas.convertToBlob({ type: outputMimeType, quality });
          if (outputBlob.type !== outputMimeType || outputBlob.size === 0)
            throw new ToolError("PROCESSING_FAILED", "The browser could not encode this image.");
          encoded =
            operation === "compress" &&
            fileMimeType === "image/png" &&
            outputBlob.size >= file.data.byteLength
              ? file.data.slice()
              : outputBlob;
        }
        const outputData =
          encoded instanceof Blob ? new Uint8Array(await encoded.arrayBuffer()) : encoded;
        const metadata =
          operation === "compress"
            ? {
                originalBytes: file.data.byteLength,
                resultBytes: outputData.byteLength,
                savedPercent: Math.max(
                  0,
                  Math.round((1 - outputData.byteLength / file.data.byteLength) * 100),
                ),
              }
            : undefined;
        outputs.push({
          name: uniqueName(outputName(file.name, operation, outputExtension, dimensions)),
          mimeType: outputMimeType,
          data: outputData,
          ...(metadata ? { metadata } : {}),
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
