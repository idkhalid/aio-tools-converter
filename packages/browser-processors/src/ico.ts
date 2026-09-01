import { ToolError } from "@aio-converter/tool-core";

export const ICO_SIZES = [16, 32, 48, 64, 128, 256] as const;

/** Build a Windows ICO containing PNG-encoded images at standard icon sizes. */
export function buildIco(pngImages: readonly Uint8Array[]): Uint8Array {
  if (pngImages.length !== ICO_SIZES.length) {
    throw new ToolError("PROCESSING_FAILED", "The browser could not encode this icon.");
  }
  const directorySize = 6 + pngImages.length * 16;
  const totalSize = directorySize + pngImages.reduce((sum, image) => sum + image.byteLength, 0);
  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, pngImages.length, true);
  let offset = directorySize;
  for (const [index, image] of pngImages.entries()) {
    const entry = 6 + index * 16;
    const size = ICO_SIZES[index] ?? 256;
    output[entry] = size === 256 ? 0 : size;
    output[entry + 1] = size === 256 ? 0 : size;
    output[entry + 2] = 0;
    output[entry + 3] = 0;
    view.setUint16(entry + 4, 1, true);
    view.setUint16(entry + 6, 32, true);
    view.setUint32(entry + 8, image.byteLength, true);
    view.setUint32(entry + 12, offset, true);
    output.set(image, offset);
    offset += image.byteLength;
  }
  return output;
}
