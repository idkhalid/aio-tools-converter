import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

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
const EXPECTED_HASH = "1767a2d0c6d6b14de37876261443397cecd591f298b162eded99018de4f6355d";

if (existsSync(wasmGzPath)) {
  const wasmGzContent = readFileSync(wasmGzPath);
  const hash = createHash("sha256").update(wasmGzContent).digest("hex");
  if (hash !== EXPECTED_HASH) {
    error(`FFmpeg WASM GZ hash mismatch! Expected: ${EXPECTED_HASH}, Actual: ${hash}`);
  }
} else {
  error(`FFmpeg WASM GZ asset not found at ${wasmGzPath}`);
}

// 4. Check for --enable-nonfree and provenance in documentation
const ffmpegDocPath = join(ROOT_DIR, "docs/compliance/ffmpeg.md");
if (existsSync(ffmpegDocPath)) {
  const docContent = readFileSync(ffmpegDocPath, "utf8");

  // Quick hack: we only care if the doc says it's built with it, but here we just check if it's explicitly documented as "not found"
  if (
    docContent.includes("--enable-nonfree: found") ||
    docContent.includes("--enable-nonfree exists")
  ) {
    error(`FFmpeg WASM binary is built with --enable-nonfree. This violates the GPL compliance.`);
  }

  if (docContent.includes("blocked pending evidence")) {
    error(
      `Release is BLOCKED: FFmpeg WASM provenance is not verified. The exact corresponding source for the distributed @ffmpeg/core WASM binary must be locally verified to satisfy GPL requirements. ACTION: Replace the pre-built WASM binary with a locally built version from verified source, and update docs/compliance/ffmpeg.md.`,
    );
  } else if (!docContent.includes("provenance verified")) {
    error(
      `Release is BLOCKED: FFmpeg WASM provenance status is undocumented. It must explicitly state 'provenance verified' or 'blocked pending evidence'.`,
    );
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
