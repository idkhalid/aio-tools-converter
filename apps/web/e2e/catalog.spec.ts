import { expect, test } from "@playwright/test";

const routes = [
  ["/image/png-to-jpg", "Convert PNG to JPG Online", "Processed on your device"],
  ["/pdf/merge-pdf", "Merge PDF Files Online", "Processed on your device"],
  ["/video/video-to-gif", "Convert Video to GIF Online", "Processed on your device"],
  ["/document/docx-to-pdf", "Convert DOCX to PDF Online", "Temporary server processing"],
  ["/image/jpg-to-png", "JPG to PNG Online", "Processed on your device"],
  ["/image/jpg-to-webp", "JPG to WebP Online", "Processed on your device"],
  ["/image/png-to-webp", "PNG to WebP Online", "Processed on your device"],
  ["/image/jpg-to-ico", "JPG to ICO Online", "Processed on your device"],
  ["/image/png-to-ico", "PNG to ICO Online", "Processed on your device"],
  ["/image/heic-to-jpg", "HEIC to JPG Online", "Processed on your device"],
  ["/image/heic-to-png", "HEIC to PNG Online", "Processed on your device"],
] as const;

test("home lists every catalog tool", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Useful converters");
  for (const [path] of routes) {
    await expect(page.locator(`a[href="${path}"]`).first()).toBeVisible();
  }
});

test("keyboard users can reach the main catalog through the skip link", async ({ page }) => {
  await page.goto("/");

  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await skipLink.press("Enter");

  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.locator("#main-content")).toBeVisible();
});

for (const [path, title, privacy] of routes) {
  test(`${path} is statically usable and has unique metadata`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`${path}$`),
    );
    await expect(page.getByText(privacy, { exact: true })).toBeVisible();
    await expect(page.getByTestId("drop-zone").locator("button")).toBeVisible();
    const fitsViewport = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fitsViewport).toBe(true);
  });
}
