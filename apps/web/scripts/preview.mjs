import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createStaticPreview } from "./static-preview.mjs";

const { values } = parseArgs({
  options: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "4321" },
  },
});

const host = values.host;
const port = Number(values.port);
if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("preview expects a valid --host and --port.");
}

const root = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
await createStaticPreview({ root, host, port });
console.log(`Static preview listening on http://${host}:${port}`);
