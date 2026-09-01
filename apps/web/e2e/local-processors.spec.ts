import { expect, test, type Page } from "@playwright/test";
import {
  attachSyntheticWebM,
  attachSyntheticJPEG,
  attachSyntheticWebP,
  inspectPDF,
  readDownload,
  syntheticPDF,
  syntheticPNG,
  syntheticPNGWithDimensions,
  trackJobRequests,
  waitForToolHydration,
} from "./fixtures";

const uploadInput = (page: Page) => page.getByTestId("drop-zone").locator('input[type="file"]');

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function decodedImageInfo(
  page: Page,
  bytes: Buffer,
): Promise<{ width: number; height: number; hasTransparency: boolean }> {
  return page.evaluate(
    async (values) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(values)]));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      bitmap.close();
      let hasTransparency = false;
      for (let index = 3; index < pixels.length; index += 4) {
        if ((pixels[index] ?? 255) < 255) {
          hasTransparency = true;
          break;
        }
      }
      return { width: canvas.width, height: canvas.height, hasTransparency };
    },
    [...bytes],
  );
}

test.describe("Phase 2 image converters", () => {
  test("converts JPG images locally", async ({ page }) => {
    const jobRequests = trackJobRequests(page);
    for (const [route, expectedName, signature] of [
      ["/image/jpg-to-png", "synthetic.png", [137, 80, 78, 71]],
      ["/image/jpg-to-webp", "synthetic.webp", [82, 73, 70, 70]],
      ["/image/jpg-to-ico", "synthetic.ico", [0, 0, 1, 0]] as const,
    ] as const) {
      await page.goto(route);
      await waitForToolHydration(page);
      await attachSyntheticJPEG(page);
      const processButton = page.getByRole("button", { name: "Process files" });
      await expect(processButton).toBeEnabled();
      await processButton.click();
      await expect(page.getByRole("heading", { name: "Your files are ready" })).toBeVisible({
        timeout: 30_000,
      });
      const link = page.getByRole("link", { name: "Download", exact: true });
      await expect(link).toHaveAttribute("download", expectedName);
      const downloadPromise = page.waitForEvent("download");
      await link.click();
      const bytes = await readDownload(await downloadPromise);
      expect([...bytes.subarray(0, signature.length)]).toEqual(signature);
      if (route.endsWith("ico")) expect(bytes[4]).toBe(6);
    }
    expect(jobRequests).toEqual([]);
  });

  test("converts PNG to WebP and valid multi-resolution ICO locally", async ({ page }) => {
    const jobRequests = trackJobRequests(page);
    for (const [route, expectedName] of [
      ["/image/png-to-webp", "synthetic.webp"],
      ["/image/png-to-ico", "synthetic.ico"],
    ] as const) {
      await page.goto(route);
      await waitForToolHydration(page);
      await uploadInput(page).setInputFiles({
        name: "synthetic.png",
        mimeType: "image/png",
        buffer: syntheticPNG(100, 20, 220, 255),
      });
      const processButton = page.getByRole("button", { name: "Process files" });
      await expect(processButton).toBeEnabled();
      await processButton.click();
      await expect(page.getByRole("heading", { name: "Your files are ready" })).toBeVisible({
        timeout: 30_000,
      });
      const link = page.getByRole("link", { name: "Download", exact: true });
      await expect(link).toHaveAttribute("download", expectedName);
      const downloadPromise = page.waitForEvent("download");
      await link.click();
      const bytes = await readDownload(await downloadPromise);
      if (route.endsWith("ico")) {
        expect([...bytes.subarray(0, 6)]).toEqual([0, 0, 1, 0, 6, 0]);
        expect(bytes.readUInt8(6)).toBe(16);
        expect(bytes.readUInt8(22)).toBe(32);
        expect(bytes.readUInt8(86)).toBe(0); // 256px is represented as zero in ICO.
      } else {
        expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
        expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
      }
    }
    expect(jobRequests).toEqual([]);
  });
});

test("batch PNG conversion downloads JPEGs and a real ZIP without server jobs", async ({
  page,
}) => {
  const jobRequests = trackJobRequests(page);
  await page.goto("/image/png-to-jpg");
  await waitForToolHydration(page);
  await uploadInput(page).setInputFiles([
    {
      name: "photo one.png",
      mimeType: "image/png",
      buffer: syntheticPNG(255, 0, 0, 128),
    },
    {
      name: "blue.png",
      mimeType: "image/png",
      buffer: syntheticPNG(0, 64, 255),
    },
  ]);

  await page.getByLabel("Quality").fill("75");
  await page.getByLabel("Transparent background").fill("#fef3c7");
  const processButton = page.getByRole("button", { name: "Process files" });
  await expect(processButton).toBeEnabled();
  await processButton.click();

  await expect(page.getByRole("heading", { name: "Your files are ready" })).toBeVisible({
    timeout: 30_000,
  });
  const downloads = page.getByRole("link", { name: "Download", exact: true });
  await expect(downloads).toHaveCount(2);
  await expect(downloads.nth(0)).toHaveAttribute("download", "photo one.jpg");
  await expect(downloads.nth(1)).toHaveAttribute("download", "blue.jpg");

  const expectedFilenames = ["photo one.jpg", "blue.jpg"];
  for (let index = 0; index < 2; index += 1) {
    const downloadPromise = page.waitForEvent("download");
    await downloads.nth(index).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(expectedFilenames[index]);
    const jpeg = await readDownload(download);
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect([...jpeg.subarray(-2)]).toEqual([0xff, 0xd9]);
  }

  const archivePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download all as ZIP" }).click();
  const archiveDownload = await archivePromise;
  expect(archiveDownload.suggestedFilename()).toBe("photo one-converted.zip");
  const archive = await readDownload(archiveDownload);
  expect([...archive.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(archive.includes(Buffer.from("photo one.jpg"))).toBe(true);
  expect(archive.includes(Buffer.from("blue.jpg"))).toBe(true);
  expect(archive.subarray(-64).includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
  expect(jobRequests).toEqual([]);
});

test("compress image preserves format and reports honest size metadata", async ({ page }) => {
  const jobRequests = trackJobRequests(page);
  await page.goto("/image/compress-image");
  await waitForToolHydration(page);
  await uploadInput(page).setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: syntheticPNG(30, 120, 220, 180),
  });
  await page.getByRole("button", { name: "Process files" }).click();
  await expect(page.getByRole("heading", { name: "Your files are ready" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("link", { name: "Download", exact: true })).toHaveAttribute(
    "download",
    "photo-compressed.png",
  );
  await expect(page.locator("span.block").filter({ hasText: /% smaller$/ })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download", exact: true }).click();
  const output = await readDownload(await downloadPromise);
  expect([...output.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(pngDimensions(output)).toEqual({ width: 3, height: 2 });
  await expect(decodedImageInfo(page, output)).resolves.toMatchObject({
    width: 3,
    height: 2,
    hasTransparency: true,
  });
  expect(jobRequests).toEqual([]);
});

test("compress image accepts JPEG and WebP locally", async ({ page }) => {
  const jobRequests = trackJobRequests(page);
  for (const [attach, expectedName, signature] of [
    [attachSyntheticJPEG, "synthetic-compressed.jpg", [0xff, 0xd8, 0xff]],
    [attachSyntheticWebP, "synthetic-compressed.webp", [0x52, 0x49, 0x46, 0x46]],
  ] as const) {
    await page.goto("/image/compress-image");
    await waitForToolHydration(page);
    await page.getByLabel("Quality").fill("65");
    await attach(page);
    await page.getByRole("button", { name: "Process files" }).click();
    await expect(page.getByRole("heading", { name: "Your files are ready" })).toBeVisible({
      timeout: 30_000,
    });
    const link = page.getByRole("link", { name: "Download", exact: true });
    await expect(link).toHaveAttribute("download", expectedName);
    const downloadPromise = page.waitForEvent("download");
    await link.click();
    const output = await readDownload(await downloadPromise);
    expect([...output.subarray(0, signature.length)]).toEqual(signature);
    expect(output.byteLength).toBeGreaterThan(0);
    await expect(decodedImageInfo(page, output)).resolves.toMatchObject({ width: 64, height: 48 });
  }
  expect(jobRequests).toEqual([]);
});

test("compress image quality changes JPEG encoding where supported", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "WebKit's canvas encoder may ignore JPEG quality for this tiny synthetic fixture.",
  );
  const outputs: Buffer[] = [];
  for (const quality of [20, 90]) {
    await page.goto("/image/compress-image");
    await waitForToolHydration(page);
    await page.getByLabel("Quality").fill(String(quality));
    await attachSyntheticJPEG(page);
    await page.getByRole("button", { name: "Process files" }).click();
    await expect(page.getByRole("heading", { name: "Your files are ready" })).toBeVisible({
      timeout: 30_000,
    });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download", exact: true }).click();
    outputs.push(await readDownload(await downloadPromise));
  }
  expect(outputs[0]).not.toEqual(outputs[1]);
});

test("resize image uses proportional dimensions, actual names, and ZIP batches", async ({
  page,
}) => {
  const jobRequests = trackJobRequests(page);
  await page.goto("/image/resize-image");
  await waitForToolHydration(page);
  await uploadInput(page).setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: syntheticPNGWithDimensions(1200, 800, 220, 80, 30, 120),
  });
  await page.getByLabel("Width").fill("600");
  await page.getByRole("button", { name: "Process files" }).click();
  await expect(page.getByRole("heading", { name: "Your files are ready" })).toBeVisible({
    timeout: 30_000,
  });
  const link = page.getByRole("link", { name: "Download", exact: true });
  await expect(link).toHaveAttribute("download", "photo-600x400.png");
  const downloadPromise = page.waitForEvent("download");
  await link.click();
  const output = await readDownload(await downloadPromise);
  expect([...output.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(pngDimensions(output)).toEqual({ width: 600, height: 400 });
  await expect(decodedImageInfo(page, output)).resolves.toMatchObject({ hasTransparency: true });

  await page.goto("/image/resize-image");
  await waitForToolHydration(page);
  await uploadInput(page).setInputFiles([
    {
      name: "landscape.png",
      mimeType: "image/png",
      buffer: syntheticPNGWithDimensions(1200, 800, 220, 80, 30),
    },
    {
      name: "portrait.png",
      mimeType: "image/png",
      buffer: syntheticPNGWithDimensions(800, 1200, 30, 80, 220),
    },
  ]);
  await page.getByLabel("Width").fill("400");
  await page.getByRole("button", { name: "Process files" }).click();
  await expect(page.getByRole("heading", { name: "Your files are ready" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("link", { name: "Download", exact: true }).nth(0)).toHaveAttribute(
    "download",
    "landscape-400x267.png",
  );
  await expect(page.getByRole("link", { name: "Download", exact: true }).nth(1)).toHaveAttribute(
    "download",
    "portrait-400x600.png",
  );
  const archivePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download all as ZIP" }).click();
  const archive = await readDownload(await archivePromise);
  expect([...archive.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(jobRequests).toEqual([]);
});

test("batch PNG conversion falls back to main thread HTMLCanvasElement when OffscreenCanvas is missing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  });
  const jobRequests = trackJobRequests(page);
  await page.goto("/image/png-to-jpg");
  await waitForToolHydration(page);
  await uploadInput(page).setInputFiles([
    {
      name: "red.png",
      mimeType: "image/png",
      buffer: syntheticPNG(255, 0, 0, 128),
    },
    {
      name: "blue.png",
      mimeType: "image/png",
      buffer: syntheticPNG(0, 0, 255, 128),
    },
  ]);

  const processButton = page.getByRole("button", { name: "Process files" });
  await expect(processButton).toBeEnabled();
  await processButton.click();

  await expect(page.getByRole("heading", { name: "Your files are ready" })).toBeVisible({
    timeout: 30_000,
  });
  const archivePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download all as ZIP" }).click();
  const archive = await readDownload(await archivePromise);
  expect([...archive.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(archive.includes(Buffer.from("red.jpg"))).toBe(true);
  expect(jobRequests).toEqual([]);
});

test("merge PDF preserves the reordered page sequence and never creates a server job", async ({
  page,
}) => {
  const jobRequests = trackJobRequests(page);
  const alpha = await syntheticPDF([[201, 301]]);
  const beta = await syntheticPDF([
    [402, 502],
    [403, 503],
  ]);
  await page.goto("/pdf/merge-pdf");
  await waitForToolHydration(page);
  await uploadInput(page).setInputFiles([
    { name: "beta.pdf", mimeType: "application/pdf", buffer: beta },
    { name: "alpha.pdf", mimeType: "application/pdf", buffer: alpha },
  ]);
  await page.getByRole("button", { name: "Move alpha.pdf up" }).click();
  await expect(page.locator("#file-queue-heading + span")).toHaveText("2 selected");

  const processButton = page.getByRole("button", { name: "Process files" });
  await expect(processButton).toBeEnabled();
  await processButton.click();
  await expect(page.getByRole("heading", { name: "Your files are ready" })).toBeVisible({
    timeout: 30_000,
  });
  const link = page.getByRole("link", { name: "Download", exact: true });
  await expect(link).toHaveAttribute("download", "alpha-merged.pdf");
  const downloadPromise = page.waitForEvent("download");
  await link.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("alpha-merged.pdf");
  const merged = await readDownload(download);

  expect(merged.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(merged.subarray(-2_048).includes(Buffer.from("%%EOF"))).toBe(true);
  const pageSizes = await inspectPDF(merged);
  expect(pageSizes).toEqual([
    { width: 201, height: 301 },
    { width: 402, height: 502 },
    { width: 403, height: 503 },
  ]);
  expect(jobRequests).toEqual([]);
});

test("video to GIF can be canceled, retried, and downloaded without a server job", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.PLAYWRIGHT_SKIP_HEAVY_MEDIA === "1",
    "Skipping heavyweight FFmpeg WASM conversion in default CI; covered by local/full E2E.",
  );
  test.skip(
    testInfo.project.name !== "chromium",
    "MediaRecorder for video/webm is only reliable in Chromium for this synthetic fixture.",
  );
  test.setTimeout(240_000);
  const jobRequests = trackJobRequests(page);
  await page.goto("/video/video-to-gif");
  await waitForToolHydration(page);
  await attachSyntheticWebM(page);
  await page.getByLabel("Clip duration").fill("1");
  await page.getByLabel("Frames per second").fill("5");
  await page.getByLabel("Output width").fill("160");

  const processButton = page.getByRole("button", { name: "Process files" });
  await expect(processButton).toBeEnabled();
  await processButton.click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(processButton).toBeVisible({ timeout: 30_000 });
  await expect(processButton).toBeEnabled();

  await processButton.click();
  await expect(page.getByRole("heading", { name: "Your files are ready" })).toBeVisible({
    timeout: 180_000,
  });
  const link = page.getByRole("link", { name: "Download", exact: true });
  await expect(link).toHaveAttribute("download", "synthetic.gif");
  const downloadPromise = page.waitForEvent("download");
  await link.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("synthetic.gif");
  const gif = await readDownload(download);
  expect(["GIF87a", "GIF89a"]).toContain(gif.subarray(0, 6).toString("ascii"));
  expect(gif.at(-1)).toBe(0x3b);
  expect(jobRequests).toEqual([]);
});
