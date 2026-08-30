import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoToGifProcessor } from "./video-to-gif";

const ffmpeg = vi.hoisted(() => ({
  deleteFile: vi.fn(async () => undefined),
  exec: vi.fn(async () => undefined),
  load: vi.fn(async () => undefined),
  on: vi.fn(),
  readFile: vi.fn(async () => new Uint8Array([0x47, 0x49, 0x46])),
  terminate: vi.fn(),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: class {
    deleteFile = ffmpeg.deleteFile;
    exec = ffmpeg.exec;
    load = ffmpeg.load;
    on = ffmpeg.on;
    readFile = ffmpeg.readFile;
    terminate = ffmpeg.terminate;
    writeFile = ffmpeg.writeFile;
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.values(ffmpeg).forEach((mock) => mock.mockClear());
});

describe("video to GIF processor", () => {
  it("retries a cached empty FFmpeg response with a cache-busting URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0x00, 0x61, 0x73, 0x6d])));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:ffmpeg-runtime");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const outputs = await createVideoToGifProcessor({
      coreURL: "/wasm/ffmpeg/ffmpeg-core.js",
      wasmGzipURL: "/wasm/ffmpeg/ffmpeg-core.wasm.gz",
    }).process(
      {
        files: [
          {
            name: "video.mp4",
            mimeType: "video/mp4",
            lastModified: 0,
            data: new Uint8Array([1]),
          },
        ],
        options: {},
      },
      { signal: new AbortController().signal, reportProgress() {} },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/wasm/ffmpeg/ffmpeg-core.wasm.gz",
      expect.objectContaining({ cache: "force-cache" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/ffmpeg_retry=/),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(ffmpeg.load).toHaveBeenCalledWith({
      coreURL: "/wasm/ffmpeg/ffmpeg-core.js",
      wasmURL: "blob:ffmpeg-runtime",
    });
    expect(outputs[0]?.name).toBe("video.gif");
  });
});
