import type { APIRoute } from "astro";
import { appConfig } from "../lib/app-config";

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(
    `User-agent: *\nAllow: /\nSitemap: ${new URL("/sitemap-index.xml", appConfig.url)}\n`,
    {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    },
  );
