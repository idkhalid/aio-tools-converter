/// <reference lib="webworker" />
import {
  createVideoToGifProcessor,
  installProcessorWorker,
} from "@aio-converter/browser-processors";

installProcessorWorker(
  createVideoToGifProcessor({
    coreURL: "/wasm/ffmpeg/ffmpeg-core.js",
    wasmGzipURL: "/wasm/ffmpeg/ffmpeg-core.wasm.gz",
  }),
);
