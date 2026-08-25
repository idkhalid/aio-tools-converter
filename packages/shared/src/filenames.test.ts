import { describe, expect, it } from "vitest";
import { dedupeFilenames, replaceExtension, sanitizeFilename } from "./filenames";

describe("filename helpers", () => {
  it("removes path traversal and reserved characters", () => {
    expect(sanitizeFilename("../../bad:<name>.png")).toBe("bad--name-.png");
  });

  it("replaces extensions and de-duplicates names", () => {
    expect(replaceExtension("photo.PNG", "jpg")).toBe("photo.jpg");
    expect(dedupeFilenames(["photo.jpg", "photo.jpg", "PHOTO.jpg"])).toEqual([
      "photo.jpg",
      "photo-2.jpg",
      "PHOTO-3.jpg",
    ]);
  });
});
