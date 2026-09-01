import { describe, expect, it } from "vitest";
import { buildIco, ICO_SIZES } from "./ico";

describe("ICO encoder", () => {
  it("writes six PNG directory entries with 256px sentinel dimensions", () => {
    const pngs = ICO_SIZES.map((size) => new Uint8Array([137, 80, 78, 71, size]));
    const ico = buildIco(pngs);
    const view = new DataView(ico.buffer);
    expect([...ico.slice(0, 6)]).toEqual([0, 0, 1, 0, 6, 0]);
    expect(ico[6]).toBe(16);
    expect(ico[22]).toBe(32);
    expect(ico[86]).toBe(0);
    expect(view.getUint32(14, true)).toBe(5);
    expect(view.getUint32(18, true)).toBe(102);
    expect([...ico.slice(102, 107)]).toEqual([137, 80, 78, 71, 16]);
  });
});
