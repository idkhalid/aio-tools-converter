import { createStaticPreview } from "./apps/web/scripts/static-preview.mjs";
import { resolve } from "node:path";

export default async function globalSetup() {
  if (process.env.PLAYWRIGHT_BASE_URL) return;

  const server = await createStaticPreview({
    root: resolve("apps/web/dist"),
    host: "127.0.0.1",
    port: 4321,
  });

  return async () => {
    server.closeAllConnections();
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose(undefined)));
    });
  };
}
