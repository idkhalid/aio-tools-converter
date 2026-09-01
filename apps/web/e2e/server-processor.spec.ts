import { expect, test } from "@playwright/test";
import { readDownload, syntheticDOCX, waitForToolHydration } from "./fixtures";

test("DOCX reports an unavailable API without falling back to browser processing", async ({
  page,
}) => {
  const jobRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/v1/jobs"))
      jobRequests.push(`${request.method()} ${url.pathname}`);
  });
  await page.route("**/v1/jobs/**", (route) => route.abort("connectionfailed"));

  await page.goto("/document/docx-to-pdf");
  await waitForToolHydration(page);
  await page.getByTestId("drop-zone").locator('input[type="file"]').setInputFiles({
    name: "staging-api-unavailable.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: syntheticDOCX(),
  });
  await page.getByRole("button", { name: "Process files" }).click();

  await expect(page.getByRole("heading", { name: "Converter service unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
  expect(jobRequests).toEqual(["POST /v1/jobs/document.docx-to-pdf"]);
});

test("DOCX converts through the ephemeral API and downloads a complete PDF", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.PLAYWRIGHT_SKIP_API_SERVER === "1",
    "The browser-only E2E mode intentionally does not start the Compose API.",
  );
  test.skip(
    testInfo.project.name === "mobile-chromium",
    "The isolated LibreOffice smoke test runs once in desktop Chromium.",
  );
  test.setTimeout(240_000);
  const apiResponses: Array<{
    method: string;
    path: string;
    status: number;
    cacheControl: string | undefined;
  }> = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/v1/jobs")) return;
    apiResponses.push({
      method: response.request().method(),
      path: url.pathname,
      status: response.status(),
      cacheControl: response.headers()["cache-control"],
    });
  });

  await page.goto("/document/docx-to-pdf");
  await waitForToolHydration(page);
  await page.getByTestId("drop-zone").locator('input[type="file"]').setInputFiles({
    name: "Surat Edaran 17 Agustus 2025.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: syntheticDOCX(),
  });
  const processButton = page.getByRole("button", { name: "Process files" });
  await expect(processButton).toBeEnabled();
  await processButton.click();
  await expect(page.getByRole("heading", { name: "Your files are ready" })).toBeVisible({
    timeout: 180_000,
  });

  const link = page.getByRole("link", { name: "Download", exact: true });
  await expect(link).toHaveAttribute("download", "Surat Edaran 17 Agustus 2025.pdf");
  const downloadPromise = page.waitForEvent("download");
  await link.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Surat Edaran 17 Agustus 2025.pdf");
  const pdf = await readDownload(download);
  expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(pdf.subarray(-2_048).includes(Buffer.from("%%EOF"))).toBe(true);

  expect(apiResponses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        method: "POST",
        path: "/v1/jobs/document.docx-to-pdf",
        status: 202,
      }),
      expect.objectContaining({
        method: "GET",
        path: expect.stringMatching(/\/events$/),
        status: 200,
      }),
      expect.objectContaining({
        method: "GET",
        path: expect.stringMatching(/\/output$/),
        status: 200,
      }),
    ]),
  );
  expect(apiResponses.every((response) => response.cacheControl?.includes("no-store"))).toBe(true);
});
