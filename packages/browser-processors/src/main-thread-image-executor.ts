import {
  asExactArrayBuffer,
  dedupeFilenames,
  deriveOutputFilename,
  mimeTypeForExtension,
} from "@aio-converter/shared";
import {
  ToolError,
  canceledError,
  type JobExecutor,
  type ProcessContext,
  type ProcessInput,
  type ProcessOutput,
  type ProcessorPreset,
} from "@aio-converter/tool-core";
import { MAX_PIXELS, validatePNGDimensions } from "./image-convert";
import { decodeHeic } from "./heic";
import { buildIco, ICO_SIZES } from "./ico";

export class MainThreadImageExecutor implements JobExecutor {
  constructor(
    private readonly options: { processorPreset?: ProcessorPreset; timeoutMs?: number },
  ) {}

  async execute(input: ProcessInput, context: ProcessContext): Promise<readonly ProcessOutput[]> {
    const preset = this.options.processorPreset;
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
    const outputs: ProcessOutput[] = [];

    for (const [index, file] of input.files.entries()) {
      if (context.signal.aborted) throw canceledError();
      context.reportProgress({
        stage: "decoding",
        progress: index / input.files.length,
        message: `Decoding image ${index + 1} of ${input.files.length}`,
      });

      const fileMimeType = file.type || mimeTypeForExtension(file.name);
      if (fileMimeType !== preset.inputMimeType) {
        throw new ToolError(
          "FILE_TYPE",
          `Expected ${preset.inputMimeType}, but received another type.`,
        );
      }

      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);

      if (preset.inputMimeType === "image/png") {
        validatePNGDimensions(data);
      }

      const heic =
        preset.inputMimeType === "image/heic" ? await decodeHeic(data, MAX_PIXELS) : undefined;
      const blob = heic ? undefined : new Blob([data], { type: preset.inputMimeType });
      const objectUrl = blob ? URL.createObjectURL(blob) : undefined;
      const img = heic ? undefined : new Image();

      try {
        await new Promise<void>((resolve, reject) => {
          if (!img || !objectUrl) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Image decode failed"));
          img.src = objectUrl;
        });

        const width = heic?.width ?? img?.width ?? 0;
        const height = heic?.height ?? img?.height ?? 0;
        if (width * height > MAX_PIXELS) {
          throw new ToolError(
            "FILE_TOO_LARGE",
            "An image has too many pixels to process safely in this browser.",
          );
        }

        const encodePng = async (size: number): Promise<Uint8Array> => {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const drawingContext = canvas.getContext("2d");
          if (!drawingContext)
            throw new ToolError("BROWSER_UNSUPPORTED", "Canvas encoding is unavailable.", false);
          const scale = Math.min(size / width, size / height);
          const drawWidth = Math.max(1, Math.round(width * scale));
          const drawHeight = Math.max(1, Math.round(height * scale));
          const x = Math.floor((size - drawWidth) / 2);
          const y = Math.floor((size - drawHeight) / 2);
          drawingContext.clearRect(0, 0, size, size);
          if (preset.flattenTransparency) {
            drawingContext.fillStyle = background;
            drawingContext.fillRect(0, 0, size, size);
          }
          if (heic) {
            const source = document.createElement("canvas");
            source.width = width;
            source.height = height;
            source
              .getContext("2d")
              ?.putImageData(
                new ImageData(
                  heic.data as unknown as Uint8ClampedArray<ArrayBuffer>,
                  width,
                  height,
                ),
                0,
                0,
              );
            drawingContext.drawImage(source, x, y, drawWidth, drawHeight);
          } else if (img) drawingContext.drawImage(img, x, y, drawWidth, drawHeight);
          const encoded = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/png"),
          );
          if (!encoded || encoded.type !== "image/png" || encoded.size === 0)
            throw new ToolError("PROCESSING_FAILED", "The browser could not encode this image.");
          return new Uint8Array(await encoded.arrayBuffer());
        };
        let encoded: Blob | Uint8Array;
        if (preset.outputMimeType === "image/x-icon") {
          const iconImages: Uint8Array[] = [];
          for (const size of ICO_SIZES) {
            if (context.signal.aborted) throw canceledError();
            iconImages.push(await encodePng(size));
          }
          encoded = buildIco(iconImages);
        } else {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
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
          else if (img) drawingContext.drawImage(img, 0, 0);
          const outputBlob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, preset.outputMimeType, quality),
          );
          if (!outputBlob || outputBlob.type !== preset.outputMimeType || outputBlob.size === 0)
            throw new ToolError("PROCESSING_FAILED", "The browser could not encode this image.");
          encoded = outputBlob;
        }

        outputs.push({
          name: names[index] ?? `converted-${index + 1}.${preset.outputExtension}`,
          mimeType: preset.outputMimeType,
          size: encoded instanceof Blob ? encoded.size : encoded.byteLength,
          blob:
            encoded instanceof Blob
              ? encoded
              : new Blob([asExactArrayBuffer(encoded)], { type: preset.outputMimeType }),
        });
      } catch (e: unknown) {
        if (e instanceof ToolError) throw e;
        throw new ToolError("PROCESSING_FAILED", "The browser could not encode this image.");
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (img) img.src = "";
      }

      context.reportProgress({
        stage: "encoding",
        progress: (index + 1) / input.files.length,
        message: `Converted image ${index + 1} of ${input.files.length}`,
      });
    }

    return outputs;
  }
}
