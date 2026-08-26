import { expect, test, type Page } from "@playwright/test";
import {
  attachSyntheticWebM,
  inspectPDF,
  readDownload,
  syntheticPDF,
  syntheticPNG,
  trackJobRequests,
  waitForToolHydration,
} from "./fixtures";

const uploadInput = (page: Page) => page.getByTestId("drop-zone").locator('input[type="file"]');

test("batch PNG conversion downloads JPEGs and a real ZIP without server jobs", async ({
  page,
}) => {
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
  await expect(downloads.nth(0)).toHaveAttribute("download", "red.jpg");
  await expect(downloads.nth(1)).toHaveAttribute("download", "blue.jpg");

  for (let index = 0; index < 2; index += 1) {
    const downloadPromise = page.waitForEvent("download");
    await downloads.nth(index).click();
    const jpeg = await readDownload(await downloadPromise);
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect([...jpeg.subarray(-2)]).toEqual([0xff, 0xd9]);
  }

  const archivePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download all as ZIP" }).click();
  const archive = await readDownload(await archivePromise);
  expect([...archive.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(archive.includes(Buffer.from("red.jpg"))).toBe(true);
  expect(archive.includes(Buffer.from("blue.jpg"))).toBe(true);
  expect(archive.subarray(-64).includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
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
  await expect(link).toHaveAttribute("download", "merged.pdf");
  const downloadPromise = page.waitForEvent("download");
  await link.click();
  const merged = await readDownload(await downloadPromise);

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
  const gif = await readDownload(await downloadPromise);
  expect(["GIF87a", "GIF89a"]).toContain(gif.subarray(0, 6).toString("ascii"));
  expect(gif.at(-1)).toBe(0x3b);
  expect(jobRequests).toEqual([]);
});
