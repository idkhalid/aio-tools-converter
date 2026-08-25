import { asExactArrayBuffer, extensionOf, replaceExtension } from "@aio-converter/shared";
import { ToolError, canceledError } from "@aio-converter/tool-core";
import type { BufferProcessor } from "./protocol";

export interface FFmpegAssetURLs {
  coreURL: string;
  wasmURL?: string;
  /** Gzip-compressed WASM, inflated lazily inside the processor worker. */
  wasmGzipURL?: string;
}

async function inflateWasmURL(gzipURL: string, signal: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(gzipURL, {
      cache: "force-cache",
      credentials: "omit",
      signal,
    });
  } catch {
    if (signal.aborted) throw canceledError();
    throw new ToolError("PROCESSING_FAILED", "The local FFmpeg runtime could not be loaded.", true);
  }
  if (!response.ok) {
    throw new ToolError(
      "PROCESSING_FAILED",
      "The local FFmpeg runtime is unavailable. Check the deployment assets.",
      true,
    );
  }

  const compressed = new Uint8Array(await response.arrayBuffer());
  if (signal.aborted) throw canceledError();
  try {
    const { gunzipSync } = await import("fflate");
    const wasm = gunzipSync(compressed);
    return URL.createObjectURL(new Blob([asExactArrayBuffer(wasm)], { type: "application/wasm" }));
  } catch {
    throw new ToolError(
      "PROCESSING_FAILED",
      "The local FFmpeg runtime is damaged and could not be opened.",
      true,
    );
  }
}

function finiteOption(
  options: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
): number {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function createVideoToGifProcessor(assets: FFmpegAssetURLs): BufferProcessor {
  return {
    async process(input, context) {
      const source = input.files[0];
      if (!source) throw new ToolError("FILE_COUNT", "Choose one video file.");
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const ffmpeg = new FFmpeg();
      const inputExtension = extensionOf(source.name) || "mp4";
      const inputName = `input.${inputExtension}`;
      const outputName = "output.gif";
      const start = Math.max(0, finiteOption(input.options, "startSeconds", 0));
      const duration = Math.min(30, Math.max(1, finiteOption(input.options, "durationSeconds", 5)));
      const fps = Math.min(20, Math.max(5, Math.round(finiteOption(input.options, "fps", 12))));
      const width = Math.min(
        960,
        Math.max(160, Math.round(finiteOption(input.options, "width", 480))),
      );
      const abort = (): void => ffmpeg.terminate();
      let inflatedWasmURL: string | undefined;
      context.signal.addEventListener("abort", abort, { once: true });
      ffmpeg.on("progress", ({ progress }) => {
        context.reportProgress({
          stage: "transcoding",
          progress: Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : null,
          message: "Creating GIF",
        });
      });

      try {
        context.reportProgress({
          stage: "loading-engine",
          progress: null,
          message: "Loading FFmpeg",
        });
        if (!assets.wasmURL && !assets.wasmGzipURL) {
          throw new ToolError(
            "PROCESSING_FAILED",
            "The FFmpeg runtime is not configured for this deployment.",
            false,
          );
        }
        inflatedWasmURL = assets.wasmGzipURL
          ? await inflateWasmURL(assets.wasmGzipURL, context.signal)
          : undefined;
        const wasmURL = inflatedWasmURL ?? assets.wasmURL;
        if (!wasmURL) {
          throw new ToolError(
            "PROCESSING_FAILED",
            "The FFmpeg runtime is not configured for this deployment.",
            false,
          );
        }
        await ffmpeg.load({
          coreURL: assets.coreURL,
          wasmURL,
        });
        if (context.signal.aborted) throw canceledError();
        await ffmpeg.writeFile(inputName, source.data);
        await ffmpeg.exec([
          "-ss",
          String(start),
          "-i",
          inputName,
          "-t",
          String(duration),
          "-vf",
          `fps=${fps},scale=${width}:-1:flags=lanczos`,
          "-loop",
          "0",
          outputName,
        ]);
        if (context.signal.aborted) throw canceledError();
        const result = await ffmpeg.readFile(outputName);
        if (!(result instanceof Uint8Array) || result.byteLength === 0) {
          throw new ToolError("PROCESSING_FAILED", "FFmpeg did not create a GIF output.");
        }
        return [
          {
            name: replaceExtension(source.name, "gif"),
            mimeType: "image/gif",
            data: result,
          },
        ];
      } catch (error: unknown) {
        if (context.signal.aborted) throw canceledError();
        if (error instanceof ToolError) throw error;
        throw new ToolError(
          "PROCESSING_FAILED",
          "The video could not be converted. Try a shorter or smaller clip.",
        );
      } finally {
        context.signal.removeEventListener("abort", abort);
        if (!context.signal.aborted) {
          await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
          ffmpeg.terminate();
        }
        if (inflatedWasmURL) URL.revokeObjectURL(inflatedWasmURL);
      }
    },
  };
}
