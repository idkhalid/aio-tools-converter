import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const appURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:4321";
const startAPI = process.env.PLAYWRIGHT_SKIP_API_SERVER !== "1";

const webServers = startAPI
  ? [
      {
        command: "docker compose up --build api",
        reuseExistingServer: !isCI,
        timeout: 300_000,
        url: "http://127.0.0.1:8080/healthz",
      },
    ]
  : [];

export default defineConfig({
  ...(isCI ? { workers: 1 } : {}),
  expect: {
    timeout: 10_000,
  },
  forbidOnly: isCI,
  fullyParallel: true,
  globalSetup: "./playwright.global-setup.ts",
  outputDir: "test-results",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
  reporter: isCI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  retries: isCI ? 2 : 0,
  testDir: "./apps/web/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 120_000,
  use: {
    acceptDownloads: true,
    baseURL: appURL,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  webServer: webServers,
});
