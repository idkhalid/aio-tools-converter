import { asExactArrayBuffer, deriveOutputFilename, extensionOf } from "@aio-converter/shared";
import { ToolError, canceledError } from "@aio-converter/tool-core";
import type { BufferProcessor } from "./protocol";

export interface FFmpegAssetURLs {
  coreURL: string;
  wasmURL?: string;
  /** Gzip-compressed WASM, inflated lazily inside the processor worker. */
  wasmGzipURL?: string;
}

function cacheBypassURL(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}ffmpeg_retry=${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

async function fetchWasm(
  url: string,
  cache: RequestCache,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetch(url, { cache, credentials: "omit", signal });
  if (!response.ok) throw new Error(`FFmpeg asset request failed with status ${response.status}`);

  const downloaded = new Uint8Array(await response.arrayBuffer());
  if (signal.aborted) throw canceledError();
  // Some development servers transparently decode `.gz` responses after
  // adding Content-Encoding: gzip. Production hosts may return the stored
  // gzip bytes directly, so accept either representation.
  const isWasm =
    downloaded[0] === 0x00 &&
    downloaded[1] === 0x61 &&
    downloaded[2] === 0x73 &&
    downloaded[3] === 0x6d;
  const wasm = isWasm ? downloaded : (await import("fflate")).gunzipSync(downloaded);
  if (wasm[0] !== 0x00 || wasm[1] !== 0x61 || wasm[2] !== 0x73 || wasm[3] !== 0x6d) {
    throw new Error("Invalid WebAssembly signature");
  }
  return wasm;
}

async function inflateWasmURL(gzipURL: string, signal: AbortSignal): Promise<string> {
  let wasm: Uint8Array;
  try {
    wasm = await fetchWasm(gzipURL, "force-cache", signal);
  } catch {
    if (signal.aborted) throw canceledError();
    try {
      // Download managers can cache an empty 204 response for the stable asset
      // URL. Retry once with a distinct URL so the browser and integrations
      // must request the real runtime again.
      wasm = await fetchWasm(cacheBypassURL(gzipURL), "no-store", signal);
    } catch {
      if (signal.aborted) throw canceledError();
      throw new ToolError(
        "PROCESSING_FAILED",
        "The local FFmpeg runtime could not be opened. Refresh the page and try again; a browser extension, download manager, or stale cache may be interfering.",
        true,
      );
    }
  }
  return URL.createObjectURL(new Blob([asExactArrayBuffer(wasm)], { type: "application/wasm" }));
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
            name: deriveOutputFilename(source.name, "gif"),
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
