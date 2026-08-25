/// <reference lib="webworker" />
import {
  createVideoToGifProcessor,
  installProcessorWorker,
} from "@aio-converter/browser-processors";
import ffmpegCoreURL from "@ffmpeg/core?url";

installProcessorWorker(
  createVideoToGifProcessor({
    coreURL: ffmpegCoreURL,
    wasmGzipURL: "/wasm/ffmpeg/ffmpeg-core.wasm.gz",
  }),
);
