import { ToolError } from "@aio-converter/tool-core";

export interface DecodedHeic {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(
    imageData: { data: Uint8ClampedArray; width: number; height: number },
    callback: (data: unknown) => void,
  ): void;
  free?(): void;
}

interface HeifModule {
  HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] };
}

type HeifFactory = () => Promise<HeifModule>;

let modulePromise: Promise<HeifModule> | undefined;

function getLibheif(): Promise<HeifModule> {
  modulePromise ??= import("libheif-js/libheif-wasm/libheif-bundle.mjs").then(async (imported) => {
    const factory = imported.default as unknown as HeifFactory;
    if (typeof factory !== "function") throw new Error("The HEIC decoder factory is unavailable.");
    return factory();
  });
  return modulePromise;
}

export async function decodeHeic(data: Uint8Array, maxPixels = 40_000_000): Promise<DecodedHeic> {
  let libheif: HeifModule;
  try {
    libheif = await getLibheif();
  } catch {
    throw new ToolError("BROWSER_UNSUPPORTED", "The HEIC decoder could not be initialized.", false);
  }

  let image: HeifImage | undefined;
  try {
    const decoder = new libheif.HeifDecoder();
    const images = decoder.decode(data);
    // Multi-image HEIF files are intentionally deterministic: convert only the first image.
    const selected = images[0];
    if (!selected) throw new Error("No image found");
    image = selected;
    const width = selected.get_width();
    const height = selected.get_height();
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw new Error("Invalid dimensions");
    }
    if (width > Math.floor(maxPixels / height)) {
      throw new ToolError(
        "FILE_TOO_LARGE",
        "An image has too many pixels to process safely in this browser.",
      );
    }
    const imageData = { data: new Uint8ClampedArray(width * height * 4), width, height };
    await new Promise<void>((resolve, reject) => {
      selected.display(imageData, (displayData) =>
        displayData ? resolve() : reject(new Error("Decode failed")),
      );
    });
    return imageData;
  } catch (error: unknown) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("FILE_SIGNATURE", "The HEIC image could not be decoded.");
  } finally {
    image?.free?.();
  }
}
