# AIO Converter - Implementation Update

> Progress snapshot: August 31, 2026

This document summarizes the implementation that is actually available in the repository. It is not an ideas list from an earlier brief and does not treat untested features as complete.

## 2026-08-31 - Cloudflare Workers Static Assets staging deployment

The Astro frontend was deployed successfully as a Cloudflare Workers Static Assets staging/demo site:

- Frontend URL: `https://aio-tools-converter.id-khalid94.workers.dev`
- Backend API URL: `https://api.atv-market.com`
- The Workers build environment now provides `PUBLIC_APP_URL` and `PUBLIC_API_URL` at Astro build time. These build variables remain separate from Worker runtime variables.
- The root `wrangler.jsonc` is valid, formatted JSONC and publishes `apps/web/dist` as the static asset directory.
- Wrangler is invoked with `--config ./wrangler.jsonc`, which targets the frontend configuration explicitly instead of running application detection against the pnpm workspace root.
- Production and non-production deployments use separate commands: `wrangler deploy` activates a version, while `wrangler versions upload` creates a preview version without replacing the active deployment.
- The initial `Hello World` response was confirmed to come from the previously active Worker version rather than the generated Astro output. Activating the current static-assets version resolved it.
- The Docker API CORS allowlist now includes both `http://localhost:4321` and the exact deployed Workers origin. Wildcard CORS was not enabled.
- The API container was recreated so the updated `API_ALLOWED_ORIGINS` value was loaded.
- Browser requests from the deployed frontend can reach the local Docker API and LibreOffice office runner through the existing Cloudflare Tunnel.
- Local environment values remain in the ignored `.env` file; no tunnel token, API token, or other secret was committed.

Workers Builds uses the following repository-root commands:

```text
Build:      pnpm --filter @aio-converter/web build
Production: npx wrangler deploy --config ./wrangler.jsonc
Preview:    npx wrangler versions upload --config ./wrangler.jsonc
```

The deployed request path is now:

```text
Cloudflare Workers static frontend
  -> https://api.atv-market.com
  -> Cloudflare Tunnel
  -> local Docker Go API
  -> LibreOffice office runner
```

This is a staging/demo deployment for preview and portfolio use. It does not change the release boundary: FFmpeg WASM provenance remains blocked pending evidence, and a production/tagged release must wait until that issue is resolved.

## 2026-08-30 - Local Docker API via Cloudflare Tunnel

Local Docker backend was exposed through Cloudflare Tunnel at:

- API base URL: `https://api.atv-market.com`
- Health check: `/healthz`
- DOCX to PDF job creation: passed through tunnel
- Server-Sent Events: passed through tunnel
- One-time PDF output download: verified through tunnel
- CORS preflight from `http://localhost:4321`: passed
- Backend mode: local Docker API + office runner behind Cloudflare Tunnel

Verified flow:

```text
POST /v1/jobs/document.docx-to-pdf
  -> 202 Accepted
  -> SSE status succeeded
  -> output PDF downloaded successfully
```

## Status summary

| Area                   | Status                     | Notes                                                                                                             |
| ---------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Monorepo foundation    | Complete                   | pnpm workspace, strict TypeScript, Astro, React, Go, lint, test, and build scripts                                |
| Core UI/UX             | Complete for the workspace | The main Converter Workspace and all production edge states are responsive and keyboard-accessible                |
| PNG to JPG             | Complete across browsers   | Passed in Chromium, Firefox, and WebKit; uses a main-thread fallback when `OffscreenCanvas` is unavailable        |
| Merge PDF              | Complete                   | Processed locally in the browser with configurable file order                                                     |
| Video to GIF           | Complete                   | Processed locally with lazily loaded FFmpeg WebAssembly                                                           |
| DOCX to PDF            | Complete for Phase 1       | Compose is healthy; the real lifecycle matrix and UI-to-LibreOffice E2E have passed                               |
| GitHub documentation   | Complete                   | Public README, technical documentation, third-party notices, and `.gitignore` have been polished                  |
| License and compliance | Temporarily blocked        | GPL-3.0-or-later adopted; license and compliance files are present; FFmpeg provenance is blocked pending evidence |
| GitHub repository      | Connected with active CI   | The `main` branch follows `origin/main`; GitHub Actions CI runs quality gates and E2E                             |
| Staging deployment     | Operational                | Static frontend on Cloudflare Workers; local Docker API and office runner exposed through Cloudflare Tunnel       |
| Production readiness   | Not yet                    | The Converter Workspace is complete; release still awaits FFmpeg WASM provenance                                  |

## Implemented features

### 1. PNG to JPG

- `LOCAL_ONLY` mode; files are not sent to the server.
- Supports 1-50 PNG files.
- 50 MiB limit per file and 200 MiB total.
- JPG quality setting from 1-100.
- A background color can be selected to flatten PNG transparency.
- A single result can be downloaded directly; batch results can be packaged as a ZIP.
- Extension, MIME, PNG signature, and image-dimension validation happen before main processing.
- A maximum of 40 million pixels helps reject images that could consume excessive memory.
- Processing runs in a dedicated Web Worker, with a main-thread `HTMLCanvasElement` fallback when the browser does not support `OffscreenCanvas`.

### 2. Merge PDF

- `LOCAL_ONLY` mode; all PDFs remain on the user's device.
- Supports 2-20 files.
- 50 MiB limit per file and 250 MiB total.
- Files can be reordered before merging.
- Output page order follows the file order in the queue.
- The processor limits the total number of pages to 1,000.
- Corrupt or encrypted PDFs are rejected with safe error messages; there is no hidden repair step.
- Processing runs in a dedicated Web Worker using `pdf-lib`.

### 3. Video to GIF

- `LOCAL_ONLY` mode for MP4, WebM, and MOV.
- One file with a maximum size of 150 MiB.
- A clip can be selected from 1-30 seconds.
- FPS setting from 5-20 and output width from 160-960 pixels.
- FFmpeg WebAssembly is loaded lazily only when the tool is used.
- The WASM runtime is stored as a gzip asset of about 10 MiB; the raw WASM of about 32 MiB is excluded from deployment output.
- Supports progress, cancellation, retry, worker cleanup, and object-URL revocation.
- FFmpeg assets generated by `predev`/`prebuild` are ignored by Git because they can be recreated from the dependency.

### 4. DOCX to PDF

- `SERVER_EPHEMERAL` mode because LibreOffice does not run directly in the browser.
- One DOCX file with a maximum size of 50 MiB.
- The browser creates a Go API job through a multipart upload.
- DOCX is validated as an OOXML ZIP, including signature, entry structure, traversal, duplicates, encryption, macro-enabled content, compression ratio, and expanded size.
- Progress and status are delivered through Server-Sent Events.
- PDF output can be downloaded only once.
- Output is checked again against the PDF signature and EOF marker before it becomes available for download.
- Jobs can be cancelled and use timeout and TTL limits of up to 15 minutes by default.
- Input is removed after the processor completes; output is cleaned up after download, cancellation, error, timeout, shutdown, or TTL expiry.
- Fidelity follows the fonts and LibreOffice capabilities in the container, so output is not guaranteed to match Microsoft Word exactly.

## Web application foundation

- Astro 7 produces static pages for the homepage, 404, sitemap, robots, and every tool route.
- React 19 is used for the generic interactive `ToolShell`.
- Tailwind CSS 4 provides the visual baseline.
- Four active routes:
  - `/image/png-to-jpg`
  - `/pdf/merge-pdf`
  - `/video/video-to-gif`
  - `/document/docx-to-pdf`
- One typed tool registry is the source of metadata, routes, limits, options, privacy mode, SEO, and processor mapping.
- The generic shell provides a drop zone, file queue, reordering, options, progress, cancellation, retry, error states, and result downloads.
- Related tools, breadcrumbs, titles, descriptions, canonical URLs, and structured metadata follow the registry.
- The application name can be changed through `PUBLIC_APP_NAME`.
- The UI is mobile-first and includes a skip link, focus states, form labels, status announcements, and basic keyboard navigation.
- The UI structure remains separate from processors so edge states and presentation changes can be applied without rewriting the conversion engine.

## Converter Workspace edge states

The production edge-state implementation for the Converter Workspace was completed on August 29, 2026. The changes retain the existing ToolShell visual baseline and do not redesign the happy path.

- **Unsupported File Type** shows `Unsupported file type`/`Unsupported format` with actions to remove or replace the file.
- **File Too Large** shows the selected size and the applicable limit, with actions to remove the file or upload a smaller one.
- **Partial Success Batch** retains every successful output, provides bulk download for successful results, and provides retry actions for each failed file.
- **Cancelled State** retains selected files and provides `Start again` and `Remove files`.
- **Browser Not Supported** gives modern-browser guidance, a way to select another file, and navigation back to the tool catalog.
- **Backend Unavailable** uses a safe message for temporary server-tool failure, with retry and file-selection actions.
- **Empty Result** handles processing that completes without downloadable output, with retry or re-upload actions.
- **Mobile Sticky Action Bar** is active only on mobile viewports when files are ready to process or results are ready to download. It uses safe-area padding and extra bottom space so content is not obscured.

The ToolShell state machine now distinguishes the `canceled`, `partial-success`, and `empty` phases. The changes only touch presentation/state orchestration in `packages/ui/src/tool-shell`; browser processors, backend/API, workers, routes, CI, compliance, package manifests, and lockfiles are unchanged.

The following regression contracts remain intact:

- The process button remains accessible as `getByRole("button", { name: "Process files" })`.
- `#file-queue-heading + span` continues to produce `2 selected` for two files.
- PNG single-file download and bulk ZIP remain available.
- Merge PDF reordering, the DOCX-to-PDF flow, the Video-to-GIF flow, and existing output filenames remain intact.

## Processing architecture

### Local path

```text
File picker/drop
  -> extension, MIME, magic-byte, size, and option validation
  -> dedicated Web Worker / ffmpeg.wasm worker
  -> Blob output or ZIP
  -> object URL download
  -> revoke URL and terminate worker
```

There is no silent fallback from a `LOCAL_ONLY` tool to the server.

### Ephemeral server path

```text
Browser
  -> Go job API
  -> random job directory in tmpfs
  -> Unix socket
  -> LibreOffice runner without network access
  -> one-time PDF download
  -> cleanup of the entire job directory
```

The API determines the `toolId`-to-processor mapping. The client cannot select an executable or server command.

## Backend and office isolation

- The API and office runner are written in Go 1.24.
- Uploads are streamed and size-limited.
- Job metadata is stored only in RAM.
- Job IDs are random and output uses one-time download.
- The lifecycle supports queuing, progress, success, failure, cancellation, timeout, TTL, and shutdown cleanup.
- The queue has a job-count limit and an absolute deadline.
- Failed cleanup is recorded and retried by the sweeper.
- The API provides a health endpoint and aggregate metrics without user filenames or file contents.
- API-to-office-runner communication uses a Unix domain socket with an optional token.
- The office-runner container:
  - runs as non-root;
  - uses a read-only filesystem;
  - uses tmpfs for scratch storage;
  - uses `network_mode: none`;
  - drops all Linux capabilities;
  - enables `no-new-privileges`;
  - has CPU, RAM, PID, and processing-time limits;
  - does not publish a port.
- By default, each runner processes only one LibreOffice job at a time.

## Security and privacy

- Browser tools and server tools have distinct privacy badges.
- Binaries from local tools never enter a `/v1/jobs` request.
- Server files are not stored in a database, object storage, CDN cache, or persistent volume.
- Original filenames are used only briefly for validation and are not stored as metadata.
- API responses use `Cache-Control: private, no-store`.
- CORS accepts only configured frontend origins; wildcards are rejected.
- Internal errors are mapped to safe user messages.
- CSP is generated at build time and includes the configured API origin.
- Frontend headers include baseline security headers plus COOP/COEP/CORP for workers and WebAssembly.
- No service worker is used for user-file requests or responses.
- A basic source audit found no exposed credentials; only the `.env.example` template is stored.

## Repository structure

```text
apps/
  web/                 Astro frontend, React islands, workers, and E2E
  api/                 Go API, office runner, Dockerfile, and integration tests
packages/
  tool-core/           Tool contracts, options, file validation, and safe errors
  tool-registry/       Tool definitions, presets, manifests, and registry validation
  browser-processors/  Image, PDF, FFmpeg, worker lifecycle, and ZIP processing
  server-contracts/    Job API client, types, and SSE parser
  ui/                  Generic ToolShell and state machine
  shared/              Binary, MIME, byte, and filename helpers
docs/
  architecture.md
  development.md
  deployment.md
```

## Developer experience and documentation

- Root scripts are available for dev, lint, typecheck, test, build, E2E, preview, formatting, and compliance.
- JavaScript dependencies are locked in `pnpm-lock.yaml`.
- `.env.example` documents URLs, origins, limits, timeouts, sockets, and concurrency.
- The `LICENSE` file was added for GNU GPLv3.
- `TRADEMARKS.md` was created to protect the project's visual identity.
- `THIRD_PARTY_NOTICES.md` was updated with the exact versions resolved by `pnpm-lock.yaml`.
- `docs/compliance/ffmpeg.md` was created to document the WASM provenance status.
- `scripts/compliance.mjs` was created and `pnpm compliance` is available as a build guard.
- `README.md` was changed from an implementation contract into a GitHub project page.
- `.gitignore` now excludes dependencies, local environment files, caches, build output, test reports, generated FFmpeg assets, Go binaries, logs, and editor/OS files.
- Separate documentation is available for architecture, development, deployment, compatibility, and third-party licenses.
- The Git repository uses the `main` branch and is connected to the GitHub remote `origin`.
- GitHub Actions CI has been added; it runs format, lint, typecheck, test, build, E2E across three Playwright browsers, and license auditing separately.

## Latest verification results

| Gate                           | Latest result                                                            |
| ------------------------------ | ------------------------------------------------------------------------ |
| `pnpm format` / `format:check` | Passed                                                                   |
| `pnpm lint`                    | Passed                                                                   |
| `go -C apps/api vet ./...`     | Passed                                                                   |
| `pnpm typecheck`               | Passed, 0 errors                                                         |
| `pnpm test`                    | Passed                                                                   |
| `go -C apps/api test ./...`    | Passed                                                                   |
| `pnpm build`                   | Passed                                                                   |
| ToolShell reducer              | 8 tests passed                                                           |
| Workspace regression E2E       | 36 passed, 4 skipped according to the heavy-media flag                   |
| `pnpm compliance`              | Intentionally fails (blocked pending FFmpeg provenance evidence)         |
| Release Compliance Audit       | The known blocker is a warning; every other error remains a hard failure |
| Playwright + API Compose       | 41 passed, 3 intentionally skipped (44 tests total)                      |
| Container lifecycle matrix     | Success, cancellation, timeout, disconnect, and restart passed           |

The full Playwright suite checked desktop/mobile routes, local-tool flows, the `HTMLCanvasElement` fallback, actual FFmpeg processing, and DOCX through API Compose in three browsers: Chromium, Firefox, and WebKit. The final result was 41 tests passed and 3 intentionally skipped (the FFmpeg smoke test runs only in Chromium desktop).

The latest Converter Workspace regressions ran in Chromium, Firefox, WebKit, and mobile Chromium with `PLAYWRIGHT_SKIP_API_SERVER=1` and `PLAYWRIGHT_SKIP_HEAVY_MEDIA=1`. Thirty-six tests passed and four Video-to-GIF tests were skipped according to the flag. The suite ran from the workspace root so the root `playwright.config.ts` was used. PNG batch ZIP, individual download, canvas fallback, Merge PDF reordering, routes, metadata, responsive layout, and mobile contracts all remained passing.

The Release Compliance Audit classifier was tightened on August 29, 2026. CI now accepts only the one exact known FFmpeg provenance blocker line as a warning; every other `[COMPLIANCE ERROR]` still fails the job. Classifier regression tests confirm that current output follows the known-blocker path, while an `--enable-nonfree` simulation still follows the real-failure path.

## Cross-browser audit, August 26, 2026

An additional browser-only audit ran against the latest build using Playwright 1.62.1 with Firefox 153.0 and WebKit 26.5 on Windows. It complements existing Chromium E2E but does not replace final validation in branded Firefox and real Safari on macOS/iOS.

### Scope tested

- Five routes (`/`, PNG to JPG, Merge PDF, Video to GIF, and DOCX to PDF) were checked at a 1280 x 720 desktop viewport and a 390 x 844 narrow viewport.
- Responsive layout, horizontal overflow, catalog, metadata, canonical URLs, privacy badges, React hydration, and form rendering were checked in Firefox and WebKit.
- Keyboard navigation and skip-link behavior were tested through activation of `#main-content`.
- PNG to JPG was tested with two synthetic PNGs, transparency background, quality, two JPG downloads, and a valid ZIP.
- Merge PDF was tested with two synthetic PDFs, reordering, three-page output order, and a valid PDF download.
- Video to GIF was tested with static WebM, duration/FPS/width options, valid GIF output, and download.
- The DOCX-to-PDF UI loaded successfully in both engines. Cross-browser DOCX conversion was not run in this session because Docker/API was inactive.
- Twenty baseline screenshots were made for five routes at two viewports and two engines. No overflow or layout breakage was found in the initial state.

### Results by browser

| Flow                         | Firefox 153.0                                             | WebKit 26.5 on Windows                                                                       |
| ---------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Routes, metadata, and layout | Passed                                                    | Passed                                                                                       |
| Skip link                    | Passed with `Tab` and `Enter`                             | Activation and target passed; `Tab` order follows WebKit/Safari `tabsToLinks` preferences    |
| PNG to JPG and ZIP           | Passed                                                    | Passed using the main-thread `HTMLCanvasElement` fallback (`OffscreenCanvas` is unavailable) |
| Merge PDF and download       | Passed                                                    | Passed                                                                                       |
| Video to GIF                 | Passed after bypassing IDM interception of the WASM asset | Passed with a static WebM fixture                                                            |
| DOCX to PDF                  | UI passed; conversion not run                             | UI passed; conversion not run                                                                |

### Diagnosis and verification-method improvements

- The Video-to-GIF E2E fixture that creates WebM through `MediaRecorder` is incompatible with WebKit and Firefox. The test is skipped gracefully for non-Chromium browsers when using the synthetic fixture.
- The WebKit fallback using main-thread canvas passed functional tests: it can process multiple files, preserve transparency, and create ZIP output without sending data to the server.
- Playwright E2E was expanded to run Firefox and WebKit on every CI commit.

### Historical follow-up from this audit

- At the time of this audit, the recommended follow-up was to reject FFmpeg 204/zero-byte responses with an appropriate message and consider a compressed asset name with a neutral extension to avoid download-manager interception.

## Real P0 backend validation results

- Success produced a valid 15,142-byte PDF; after one-time download, both job roots were empty.
- Cancellation occurred while the job status was truly `running`; DELETE returned 204 and both job roots were empty.
- Timeout was triggered from the real office runner with a 1 ms limit; the API reported `timed_out` with the `process_timeout` code, then the default configuration was restored.
- Disconnect was tested with a 1,400,949-byte PDF output; the client disconnected after receiving 3,756 bytes and cleanup still completed in both roots.
- The API restarted while a job was still `running`; after health recovered, the old ID returned 404 and both job roots were empty.
- `/work/jobs` and `/work/office-jobs` were verified empty again after every scenario. The `/run/aio-office/office.sock` socket remained available as expected.
- The full Playwright suite with the API container active completed in 24 seconds: 18 passed and 2 intentional skips.

This validation also found and fixed the upload E2E hydration race, FFmpeg gzip compatibility in the Vite development server, FFmpeg core import from the public directory, and a flaky TTL assertion that ran before asynchronous cleanup.

## Runtime status at the snapshot

- The development frontend runs at <http://localhost:4321>.
- The staging/demo frontend is active at <https://aio-tools-converter.id-khalid94.workers.dev>.
- The public staging API is reachable through Cloudflare Tunnel at <https://api.atv-market.com>.
- The homepage, DOCX-to-PDF route, and API `/healthz` respond with HTTP 200.
- Docker Desktop 29.7.2 is installed for the per-user installation.
- WSL and the Docker Linux engine are active; the Docker server reports version 29.7.2.
- The `api` and `office-runner` images built successfully through Compose.
- The API and office-runner containers are running and healthy.
- A synthetic DOCX was converted end-to-end into a valid PDF through all three job endpoints: `POST`, SSE, and output.

## Open items at this snapshot

1. The provenance/source tree for `@ffmpeg/core` remains unresolved (blocked pending evidence).

## Next priorities

### P0 - Real backend validation (complete)

- The success, cancellation, timeout, download-disconnect, restart, and cleanup matrix passed in real Compose.
- Both job directories returned empty after every failed and successful scenario.
- The full Playwright suite passed with the API container active: 18 passed and 2 intentional skips.

### P0 - Release compliance

- License adoption: **complete** (GPL-3.0-or-later).
- Compliance guardrail: **complete** (`pnpm compliance`).
- Exact FFmpeg corresponding source/provenance: **blocked pending evidence**.
- Next action: compile FFmpeg WASM locally from a verified source tree, or replace it with a reviewed custom LGPL-only build.

### P1 - Converter Workspace design pass (complete)

- The main Converter Workspace remains the visual baseline; the happy path was not redesigned during the edge-state pass.
- Unsupported, oversized, partial-success, cancelled, browser-unsupported, backend-unavailable, empty-result, and mobile sticky-action-bar states have been implemented.
- ToolShell contracts, processors, output filenames, mobile layout, keyboard behavior, focus, and announcements remain intact.

### P1 - Release confidence (complete)

- GitHub CI automatically runs format, lint, typecheck, build, and browser-only E2E in Chromium, Firefox, and WebKit.
- The WebKit PNG fallback is implemented and fully tested by cross-browser E2E.

## Release compliance status

- **Source license**: GPL-3.0-or-later
- **Trademark/brand assets**: Reserved (protected through `TRADEMARKS.md`)
- **Third-party notices**: Updated (using the exact versions resolved by the lockfile)
- **FFmpeg configure status**: `--enable-gpl` found, `--enable-nonfree` not found
- **FFmpeg provenance**: Blocked pending evidence
- **Public repo**: OK (source may be published)
- **Production/tagged release**: Blocked (FFmpeg WASM provenance evidence is required before full public distribution)

## Important commands

```bash
pnpm dev
pnpm dev:docker
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm format:check
pnpm compliance
```

Further documentation:

- [README](README.md)
- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Deployment](docs/deployment.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
