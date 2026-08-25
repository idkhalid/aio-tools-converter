import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const mode = process.argv.includes("dev") ? "development" : "production";
const env = loadEnv(mode, workspaceRoot, "");
const configuredSite = process.env.PUBLIC_APP_URL || env.PUBLIC_APP_URL;
const configuredAPI = process.env.PUBLIC_API_URL || env.PUBLIC_API_URL;
const requiresPublicOrigins =
  mode === "production" &&
  [process.env.CI, process.env.CF_PAGES, process.env.AIO_REQUIRE_PUBLIC_ORIGINS].some((value) =>
    ["1", "true"].includes(value?.toLowerCase() ?? ""),
  );
if (requiresPublicOrigins && (!configuredSite || !configuredAPI)) {
  throw new Error("PUBLIC_APP_URL and PUBLIC_API_URL are required for CI and deployment builds.");
}

const siteValue = configuredSite || "http://localhost:4321";
const site = new URL(siteValue);
const apiValue = configuredAPI || "http://localhost:8080";
const api = new URL(apiValue);

if (
  !["http:", "https:"].includes(site.protocol) ||
  site.pathname !== "/" ||
  site.search ||
  site.hash ||
  site.username ||
  site.password
) {
  throw new Error(
    "PUBLIC_APP_URL must be an absolute http(s) origin without credentials, a path, query, or hash.",
  );
}

if (
  !["http:", "https:"].includes(api.protocol) ||
  api.pathname !== "/" ||
  api.search ||
  api.hash ||
  api.username ||
  api.password
) {
  throw new Error(
    "PUBLIC_API_URL must be an absolute http(s) origin without credentials, a path, query, or hash.",
  );
}

export default defineConfig({
  site: site.origin,
  output: "static",
  markdown: {
    syntaxHighlight: false,
  },
  integrations: [react(), sitemap()],
  security: {
    csp: {
      scriptDirective: {
        resources: ["'self'", "'wasm-unsafe-eval'"],
      },
      styleDirective: {
        resources: ["'self'"],
      },
      directives: [
        "default-src 'self'",
        "base-uri 'self'",
        `connect-src 'self' ${api.origin} blob:`,
        "font-src 'self'",
        "form-action 'none'",
        "frame-src 'none'",
        "img-src 'self' data: blob:",
        "manifest-src 'self'",
        "media-src 'self' blob:",
        "object-src 'none'",
        "worker-src 'self' blob:",
      ],
    },
  },
  vite: {
    envDir: workspaceRoot,
    plugins: [tailwindcss()],
    worker: {
      format: "es",
    },
  },
});
