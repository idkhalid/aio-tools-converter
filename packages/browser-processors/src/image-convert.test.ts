import { describe, expect, it } from "vitest";
import { calculateResizeDimensions, outputExtensionForMime, outputName } from "./image-convert";

describe("image utility dimensions and naming", () => {
  it("derives locked dimensions from width for landscape and portrait images", () => {
    expect(calculateResizeDimensions({ width: 1200, height: 800 }, { width: 600 })).toEqual({
      width: 600,
      height: 400,
    });
    expect(calculateResizeDimensions({ width: 800, height: 1200 }, { width: 400 })).toEqual({
      width: 400,
      height: 600,
    });
  });

  it("derives locked width from a height-only request and handles square images", () => {
    expect(calculateResizeDimensions({ width: 1200, height: 800 }, { height: 200 })).toEqual({
      width: 300,
      height: 200,
    });
    expect(calculateResizeDimensions({ width: 512, height: 512 }, { width: 256 })).toEqual({
      width: 256,
      height: 256,
    });
  });

  it("supports unlocked integer dimensions and rejects invalid values", () => {
    expect(
      calculateResizeDimensions(
        { width: 1200, height: 800 },
        {
          width: 640,
          height: 360,
          lockAspectRatio: false,
        },
      ),
    ).toEqual({ width: 640, height: 360 });
    expect(() =>
      calculateResizeDimensions({ width: 1200, height: 800 }, { width: 0, height: 200 }),
    ).toThrow("positive width and height");
  });

  it("uses honest utility output names and extensions", () => {
    expect(outputName("photo.jpg", "compress", "jpg", { width: 1, height: 1 })).toBe(
      "photo-compressed.jpg",
    );
    expect(outputName("photo.png", "resize", "png", { width: 800, height: 600 })).toBe(
      "photo-800x600.png",
    );
    expect(outputExtensionForMime("image/jpeg")).toBe("jpg");
    expect(outputExtensionForMime("image/png")).toBe("png");
    expect(outputExtensionForMime("image/webp")).toBe("webp");
  });
});
