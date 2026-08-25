import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gzip } from "node:zlib";

const coreEntry = fileURLToPath(import.meta.resolve("@ffmpeg/core"));
const sourceDirectory = dirname(coreEntry);
const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const targetDirectory = join(appDirectory, "public", "wasm", "ffmpeg");
const gzipAsync = promisify(gzip);

await mkdir(targetDirectory, { recursive: true });
await rm(join(targetDirectory, "ffmpeg-core.js"), { force: true });
const wasm = await readFile(join(sourceDirectory, "ffmpeg-core.wasm"));
const compressedWasm = await gzipAsync(wasm, { level: 9 });
await writeFile(join(targetDirectory, "ffmpeg-core.wasm.gz"), compressedWasm);
await rm(join(targetDirectory, "ffmpeg-core.wasm"), { force: true });
