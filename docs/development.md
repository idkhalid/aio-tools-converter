# Development

## Prerequisites

- Node.js 22.14 or newer
- Corepack and pnpm 11
- Go 1.24 or newer
- Docker Compose for end-to-end DOCX-to-PDF
- Playwright Chromium for E2E testing

## Initial setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

Copy `.env.example` to `.env` when you need to change an origin, API URL, limit, or timeout. The source defaults are intended for local development only.

## Running the application

Run the local frontend to use the three `LOCAL_ONLY` tools immediately:

```bash
pnpm dev
```

To run DOCX-to-PDF through the isolated LibreOffice workflow, start the frontend with the container stack:

```bash
pnpm dev:docker
```

Or start only the backend:

```bash
pnpm dev:api
```

`office-runner` starts as a dependency. It has no published port and no network access.

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Staging-like build validation

Build-time public origins are embedded into canonical URLs and CSP. Before handing a branch to staging, validate with approved placeholder or staging origins rather than localhost:

```bash
PUBLIC_APP_URL=https://staging.example.invalid \
PUBLIC_API_URL=https://api-staging.example.invalid \
AIO_REQUIRE_PUBLIC_ORIGINS=1 \
pnpm --filter @aio-converter/web build
```

Use real staging origins only in local ignored environment files or the deployment provider. The full Pages, Compose, Tunnel, CORS, and smoke-test procedure is in [deployment.md](deployment.md).

The Go API can be tested on the host without LibreOffice because its integration tests use an injected processor:

```bash
cd apps/api
go test ./...
```

`pnpm test:e2e` requires Docker because it covers the server tool. For a browser-only audit when Docker is unavailable, set `PLAYWRIGHT_SKIP_API_SERVER=1`; that result does not replace the containerized DOCX smoke test.

## Browser compatibility

| Tool         | Minimum requirements                                                 | Notes                                                                                                                          |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| PNG to JPG   | Web Worker, `createImageBitmap`, and `OffscreenCanvas.convertToBlob` | Tested in desktop and mobile Chromium; browsers without the required worker codec show a local error, with no upload fallback. |
| Merge PDF    | Web Worker, Blob, and ArrayBuffer                                    | Does not depend on a server.                                                                                                   |
| Video to GIF | WebAssembly, Web Worker, Blob URL, and sufficient device memory      | A cold start downloads a compressed core of about 10 MiB.                                                                      |
| DOCX to PDF  | Fetch, multipart, and SSE                                            | Requires the API and `office-runner`; fidelity follows LibreOffice and the container fonts.                                    |

The current Astro build target includes Chrome/Edge 111, Firefox 114, and Safari/iOS 16.4 or newer. Phase 1 automated E2E uses Chromium; manual Safari and Firefox testing is still required before claiming production-grade cross-browser support.

## FFmpeg runtime

The FFmpeg core loads lazily when Video to GIF runs. Vite publishes the `@ffmpeg/core` ESM entry as a build asset that the worker can import, while the web script only gzips WASM from the dependency into `apps/web/public/wasm` before `dev` or `build`. The browser worker fetches and opens `.wasm.gz` only when the tool runs; the loader accepts both gzip bytes and WASM transparently decoded by the development server. The 32 MiB raw WASM is excluded from deployment output, and generated assets do not need to be committed to Git.

## Phase 1 limits

- Transparent PNG files are flattened to the selected background color when converted to JPG.
- Merge PDF rejects encrypted or corrupt input; it does not silently repair documents.
- Video to GIF is limited to short clips because FFmpeg WebAssembly uses device memory.
- DOCX-to-PDF does not guarantee a layout identical to Microsoft Word; output follows the fonts and LibreOffice capabilities in the runner image.
- The Converter Workspace and global areas use a mobile-first, keyboard-accessible Phase 1 visual baseline. Future visual work must preserve existing processor, accessibility, and edge-state contracts.

## License gate before release

AIO Converter source is licensed under `GPL-3.0-or-later`, and the public repository may be shared. The Phase 1 prebuilt `@ffmpeg/core` runtime declares `GPL-2.0-or-later`, but the corresponding source and build provenance for its WASM artifact still lack verified evidence. Therefore, production deployment and tagged releases that distribute the current Video to GIF runtime remain blocked until evidence is available or the runtime is replaced with an audited build. See `THIRD_PARTY_NOTICES.md` and the [FFmpeg provenance gate](compliance/ffmpeg.md).
