import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { archiveZipProcessor } from "./archive";

describe("ZIP archive processor", () => {
  it("packages every output with de-duplicated safe names", async () => {
    const outputs = await archiveZipProcessor.process(
      {
        files: [
          {
            name: "photo.jpg",
            mimeType: "image/jpeg",
            lastModified: 0,
            data: new Uint8Array([1, 2]),
          },
          {
            name: "photo.jpg",
            mimeType: "image/jpeg",
            lastModified: 0,
            data: new Uint8Array([3, 4]),
          },
        ],
        options: {},
      },
      { signal: new AbortController().signal, reportProgress() {} },
    );
    const archive = outputs[0];
    expect(archive?.mimeType).toBe("application/zip");
    const entries = unzipSync(archive?.data ?? new Uint8Array());
    expect([...Object.keys(entries)].sort()).toEqual(["photo-2.jpg", "photo.jpg"]);
    expect([...entries["photo.jpg"]!]).toEqual([1, 2]);
    expect([...entries["photo-2.jpg"]!]).toEqual([3, 4]);
  });
});
