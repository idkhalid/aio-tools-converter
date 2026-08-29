import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const ROOT_DIR = process.cwd();

// Paths to verify
const REQUIRED_FILES = ["LICENSE", "TRADEMARKS.md", "docs/compliance/ffmpeg.md"];

const PACKAGE_JSONS = [
  "package.json",
  "apps/web/package.json",
  "packages/browser-processors/package.json",
  "packages/server-contracts/package.json",
  "packages/shared/package.json",
  "packages/tool-core/package.json",
  "packages/tool-registry/package.json",
  "packages/ui/package.json",
];

let hasErrors = false;

function error(msg) {
  console.error(`[COMPLIANCE ERROR] ${msg}`);
  hasErrors = true;
}

function info(msg) {
  console.log(`[COMPLIANCE INFO] ${msg}`);
}

// 1. Verify existence of required files
for (const file of REQUIRED_FILES) {
  if (!existsSync(join(ROOT_DIR, file))) {
    error(`Required file missing: ${file}`);
  }
}

// 2. Verify package license fields
for (const pkgPath of PACKAGE_JSONS) {
  const fullPath = join(ROOT_DIR, pkgPath);
  if (!existsSync(fullPath)) continue;
  try {
    const data = JSON.parse(readFileSync(fullPath, "utf8"));
    if (data.license !== "GPL-3.0-or-later") {
      error(
        `Incorrect license in ${pkgPath}. Expected 'GPL-3.0-or-later', found '${data.license}'`,
      );
    }
  } catch (e) {
    error(`Failed to read or parse ${pkgPath}: ${e.message}`);
  }
}

// 3. Verify FFmpeg asset hashes
const wasmGzPath = join(ROOT_DIR, "apps/web/public/wasm/ffmpeg/ffmpeg-core.wasm.gz");
const EXPECTED_GZIP_HASH = "1767a2d0c6d6b14de37876261443397cecd591f298b162eded99018de4f6355d";
const EXPECTED_RAW_WASM_HASH = "9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7";

if (!existsSync(wasmGzPath)) {
  error(
    `FFmpeg WASM GZ asset not found at ${wasmGzPath}. ` +
      `Run 'corepack pnpm --filter @aio-converter/web run prebuild' to generate the audit input; ` +
      `generation does not resolve the provenance blocker.`,
  );
} else {
  try {
    const wasmGzContent = readFileSync(wasmGzPath);
    const gzipHash = createHash("sha256").update(wasmGzContent).digest("hex");
    if (gzipHash !== EXPECTED_GZIP_HASH) {
      console.warn(
        `[COMPLIANCE WARNING] FFmpeg WASM GZ hash differs from documented local hash. ` +
          `Expected: ${EXPECTED_GZIP_HASH}, Actual: ${gzipHash}. ` +
          `This is allowed because the decompressed WASM hash is authoritative.`,
      );
    }

    let rawWasm;
    try {
      rawWasm = gunzipSync(wasmGzContent);
    } catch (cause) {
      error(`Unable to decompress FFmpeg WASM GZ asset: ${cause.message}`);
    }

    if (rawWasm) {
      const rawHash = createHash("sha256").update(rawWasm).digest("hex");
      if (rawHash !== EXPECTED_RAW_WASM_HASH) {
        error(
          `FFmpeg raw WASM hash mismatch! Expected: ${EXPECTED_RAW_WASM_HASH}, Actual: ${rawHash}`,
        );
      } else {
        info(`FFmpeg raw WASM hash matches ${EXPECTED_RAW_WASM_HASH}.`);
      }

      const hasEnableGpl = rawWasm.includes(Buffer.from("--enable-gpl", "ascii"));
      const hasEnableNonfree = rawWasm.includes(Buffer.from("--enable-nonfree", "ascii"));
      info(
        `Embedded configure markers: --enable-gpl=${hasEnableGpl ? "found" : "not found"}, ` +
          `--enable-nonfree=${hasEnableNonfree ? "found" : "not found"}.`,
      );
      if (hasEnableNonfree) {
        error(
          "FFmpeg raw WASM contains --enable-nonfree and is not eligible for distribution. " +
            "Replace it with a reviewed build that omits nonfree components.",
        );
      }
    }
  } catch (cause) {
    error(`Unable to read FFmpeg WASM GZ asset: ${cause.message}`);
  }
}

// 4. Enforce the repository-local provenance decision.
const ffmpegDocPath = join(ROOT_DIR, "docs/compliance/ffmpeg.md");
if (existsSync(ffmpegDocPath)) {
  const docContent = readFileSync(ffmpegDocPath, "utf8");
  const statusMatches = [
    ...docContent.matchAll(
      /^\*\*Provenance status\*\*:\s*`(blocked pending evidence|provenance verified)`\s*$/gm,
    ),
  ];

  if (statusMatches.length !== 1) {
    error(
      "FFmpeg provenance status must appear exactly once in docs/compliance/ffmpeg.md as " +
        "'**Provenance status**: `blocked pending evidence`' or " +
        "'**Provenance status**: `provenance verified`'.",
    );
  } else if (statusMatches[0]?.[1] === "blocked pending evidence") {
    error(
      "Release is BLOCKED: FFmpeg WASM provenance is not verified. " +
        "Complete Path A or Path B in docs/compliance/ffmpeg.md, publish the exact Corresponding Source bundle, " +
        "record its hashes/build evidence, and only then mark provenance verified.",
    );
  } else {
    info("FFmpeg documentation marks provenance verified.");
  }
}

if (hasErrors) {
  console.error(
    "\nCompliance verification failed! Please resolve the above errors before proceeding.",
  );
  process.exit(1);
} else {
  console.log("Compliance verification passed.");
  process.exit(0);
}
