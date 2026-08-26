import { dedupeFilenames, replaceExtension } from "@aio-converter/shared";
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
      input.files.map((file) => replaceExtension(file.name, preset.outputExtension)),
    );
    const outputs: ProcessOutput[] = [];

    for (const [index, file] of input.files.entries()) {
      if (context.signal.aborted) throw canceledError();
      context.reportProgress({
        stage: "decoding",
        progress: index / input.files.length,
        message: `Decoding image ${index + 1} of ${input.files.length}`,
      });

      if (file.type !== preset.inputMimeType) {
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

      const blob = new Blob([data], { type: preset.inputMimeType });
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();

      try {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Image decode failed"));
          img.src = objectUrl;
        });

        if (img.width * img.height > MAX_PIXELS) {
          throw new ToolError(
            "FILE_TOO_LARGE",
            "An image has too many pixels to process safely in this browser.",
          );
        }

        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const drawingContext = canvas.getContext("2d", { alpha: !preset.flattenTransparency });

        if (!drawingContext) {
          throw new ToolError("BROWSER_UNSUPPORTED", "Canvas encoding is unavailable.", false);
        }

        if (preset.flattenTransparency) {
          drawingContext.fillStyle = background;
          drawingContext.fillRect(0, 0, img.width, img.height);
        }
        drawingContext.drawImage(img, 0, 0);

        const encoded = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, preset.outputMimeType, quality);
        });

        if (!encoded || encoded.type !== preset.outputMimeType || encoded.size === 0) {
          throw new ToolError("PROCESSING_FAILED", "The browser could not encode this image.");
        }

        outputs.push({
          name: names[index] ?? `converted-${index + 1}.${preset.outputExtension}`,
          mimeType: preset.outputMimeType,
          size: encoded.size,
          blob: encoded,
        });
      } catch (e: unknown) {
        if (e instanceof ToolError) throw e;
        throw new ToolError("PROCESSING_FAILED", "The browser could not encode this image.");
      } finally {
        URL.revokeObjectURL(objectUrl);
        img.src = "";
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
