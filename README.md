<p align="center">
  <img src="apps/web/public/favicon.svg" width="72" height="72" alt="AIO Converter logo">
</p>

<h1 align="center">AIO Converter</h1>

<p align="center">
  A browser-first file conversion toolbox with transparent privacy boundaries and a small, focused Phase&nbsp;1 toolset.
</p>

<p align="center">
  <a href="#phase-1-tools">Tools</a> &middot;
  <a href="#privacy-model">Privacy</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#demo-and-staging">Demo</a> &middot;
  <a href="#local-development">Local development</a> &middot;
  <a href="#testing">Testing</a>
</p>

> **Phase 1 status: preview-ready, not production-ready.** The four Phase 1 tools, Converter Workspace edge states, global visual system, and staging path are implemented. A production or tagged release remains blocked while FFmpeg WASM provenance awaits evidence.

## What it is

AIO Converter is a compact SaaS-style conversion app for everyday files. It keeps tools that can run safely in the browser on the device, and uses a deliberately short-lived server workflow only where a native application is necessary. The result is a clear product boundary: users can see whether a file stays local or is processed ephemerally before they start.

## Phase 1 tools

| Tool         | Route                   | Processing       | Phase 1 capability                                                                                     |
| ------------ | ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| PNG to JPG   | `/image/png-to-jpg`     | Browser-local    | Converts one or many PNG files to JPG, with quality/background controls and ZIP output for batches.    |
| Merge PDF    | `/pdf/merge-pdf`        | Browser-local    | Combines selected PDFs in the user-controlled queue order.                                             |
| Video to GIF | `/video/video-to-gif`   | Browser-local    | Converts a short MP4, WebM, or MOV clip to GIF with duration, FPS, and width controls.                 |
| DOCX to PDF  | `/document/docx-to-pdf` | Server-ephemeral | Converts one validated DOCX through an isolated LibreOffice runner and offers a one-time PDF download. |

All four routes share the same typed tool registry, metadata, validation, privacy labels, accessibility contracts, and responsive Converter Workspace behavior.

## Privacy model

### Browser-local tools

PNG to JPG, Merge PDF, and Video to GIF are `LOCAL_ONLY`. Their files are processed in the browser through browser processors and workers where supported; they are not sent to the job API, and there is no silent server fallback.

### Ephemeral server tool

DOCX to PDF is `SERVER_EPHEMERAL` because LibreOffice cannot run in the browser. The Go API streams the upload to a temporary job area, forwards work to an isolated LibreOffice runner over a Unix socket, and removes inputs and outputs through the job lifecycle. Job metadata stays in memory, output is available for one download, and API file responses use `Cache-Control: private, no-store`.

This is a practical privacy model, not a blanket compliance guarantee. Review the [security and privacy caveats](#security-and-privacy-caveats) before using the service with sensitive material.

## Architecture

```text
Astro static pages + React interactive workspace
                 |
                 v
        Typed tool registry and contracts
          |                       |
          | LOCAL_ONLY            | SERVER_EPHEMERAL
          v                       v
Browser processors/workers      Go job API
  -> Blob or ZIP download          |
                                  v
                    Unix socket -> LibreOffice runner
                                  |
                                  v
                       one-time PDF download
```

| Layer              | Technology                                      | Responsibility                                                                          |
| ------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Frontend           | Astro, React, Tailwind CSS                      | Static routes, metadata, accessibility, and the Converter Workspace.                    |
| Registry           | Typed TypeScript workspace packages             | Tool routes, limits, options, privacy mode, SEO metadata, and processor mapping.        |
| Browser processing | Web Workers, `pdf-lib`, `ffmpeg.wasm`, `fflate` | Local conversion, progress, cancellation, and download creation.                        |
| Server processing  | Go API                                          | Streaming DOCX uploads, job lifecycle, events, one-time output, and cleanup.            |
| Office runner      | LibreOffice container                           | Network-isolated document conversion with temporary scratch storage.                    |
| Deployment         | Docker Compose                                  | Connects the API and office runner through a Unix socket with security/resource limits. |

Read [the architecture guide](docs/architecture.md) for processing flows and security invariants.

## Demo and staging

### Live preview

- Frontend: [https://demo.atv-market.com](https://demo.atv-market.com)
- Backend API: [https://api.atv-market.com](https://api.atv-market.com)

The public staging deployment has been manually verified across every Phase 1 route and both target viewport sizes:

| Check                                    | Result                         |
| ---------------------------------------- | ------------------------------ |
| Homepage `/`                             | Passed                         |
| PNG to JPG `/image/png-to-jpg`           | Passed                         |
| Merge PDF `/pdf/merge-pdf`               | Passed                         |
| Video to GIF `/video/video-to-gif`       | Passed                         |
| DOCX to PDF `/document/docx-to-pdf`      | Passed through the staging API |
| Mobile layout                            | Passed at 390 px               |
| Desktop layout                           | Passed at 1440 px              |
| DOCX request target observed in DevTools | `https://api.atv-market.com`   |

### Screenshots

<table>
  <thead>
    <tr>
      <th>Desktop (1440 x 900)</th>
      <th>Mobile (390 x 844)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><img src="docs/screenshots/home-viewport-desktop.png" alt="AIO Converter homepage at a 1440 pixel desktop viewport"></td>
      <td><img src="docs/screenshots/home-viewport-mobile.png" alt="AIO Converter homepage at a 390 pixel mobile viewport" width="390"></td>
    </tr>
  </tbody>
</table>

[Browse the full-page homepage and converter screenshots](docs/screenshots/).

#### DOCX to PDF live API verification

The following captures came from one live conversion of a synthetic DOCX. The browser reached the configured API, received the completed PDF, and downloaded the one-time output. Ephemeral job identifiers are redacted, and no credentials or tokens are shown.

<p align="center">
  <img src="docs/screenshots/docx-to-pdf-success-panel.png" alt="Successful DOCX to PDF conversion with the generated PDF ready to download" width="800">
</p>

<p align="center">
  <img src="docs/screenshots/docx-api-request-evidence.png" alt="Captured DOCX job requests targeting api.atv-market.com with successful response statuses" width="1200">
</p>

The supported preview path uses Cloudflare Workers Static Assets or a similar static host for `apps/web/dist`, plus Docker Compose for the Go API and LibreOffice runner. A Cloudflare Tunnel exposes the loopback-only API without directly publishing its port.

Use fixed HTTPS staging origins for `PUBLIC_APP_URL`, `PUBLIC_API_URL`, and `API_ALLOWED_ORIGINS`. Document only intentionally public staging origins; keep private hostnames, server addresses, tunnel credentials, and processor tokens out of Git. The full reproducible setup, including CSP/CORS verification, health checks, smoke tests, cleanup checks, and a placeholder-only Tunnel configuration, is in [docs/deployment.md](docs/deployment.md).

Staging/demo deployment is appropriate for preview and portfolio use. It is not a production release claim while the FFmpeg provenance gate remains unresolved.

## Local development

### Prerequisites

- Node.js 22.14 or newer
- Corepack and pnpm 11
- Go 1.24 or newer for API checks
- Docker Compose for DOCX-to-PDF and full-stack E2E
- Playwright Chromium for browser E2E

### Frontend and browser-local tools

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:4321>. PNG to JPG, Merge PDF, and Video to GIF work without the API. Copy `.env.example` to an ignored `.env` only when local defaults need overriding.

### Docker/API quickstart

Start the document-processing stack in a second terminal:

```bash
docker compose up --build -d
docker compose ps
curl --fail --show-error http://127.0.0.1:8080/healthz
```

The API is bound to `127.0.0.1:8080`; the LibreOffice runner has no published port and no network access. For a single command that starts the frontend and API together, use `pnpm dev:docker`.

See [docs/development.md](docs/development.md) for browser compatibility, staging-like builds, and E2E prerequisites.

## Testing

Install Playwright Chromium once per development machine:

```bash
pnpm exec playwright install chromium
```

Run the standard quality gates from the repository root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm test:e2e` needs Docker for the DOCX-to-PDF flow. `pnpm compliance` is also part of release review; its known FFmpeg provenance blocker is documented below and does not make a production release acceptable.

## Security and privacy caveats

- Browser-local tools do not use the job API, but Video to GIF can consume substantial memory and may not be suitable for low-end devices or long clips.
- DOCX-to-PDF files are intentionally short-lived, but LibreOffice fidelity depends on the fonts and capabilities available in the runner image; a PDF may not precisely match Microsoft Word layout.
- The API is designed for temporary processing, not as a persistent file store. Do not assume it meets a regulated-data requirement without an environment-specific security review.
- Staging deployments should use HTTPS, exact-origin CORS, the existing CSP/security headers, and a loopback-only API behind an approved proxy or Tunnel. Do not weaken those controls to work around a deployment issue.
- Do not commit `.env` files, user documents, private or unapproved hostnames, server IPs, tunnel credentials, or processor tokens.

## Release status and compliance

| Area                         | Current status                                  |
| ---------------------------- | ----------------------------------------------- |
| Source license               | **GPL-3.0-or-later**                            |
| Public source repository     | OK                                              |
| FFmpeg WASM provenance       | **Blocked pending evidence**                    |
| Production or tagged release | **Blocked until FFmpeg provenance is resolved** |

The repository can be shared publicly under GPL-3.0-or-later. However, the prebuilt FFmpeg WASM artifact does not yet have verified corresponding-source/build provenance. That evidence, or an audited replacement runtime, must be in place before a production deployment or tagged release. See [the FFmpeg provenance gate](docs/compliance/ffmpeg.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Roadmap

1. Resolve the FFmpeg WASM provenance evidence required for release confidence.
2. Deploy and operate the documented preview/staging environment.
3. Add further tools only after the release/compliance baseline is satisfied.

## Documentation

- [Architecture and privacy model](docs/architecture.md)
- [Local development and browser compatibility](docs/development.md)
- [Staging/preview deployment guide](docs/deployment.md)
- [FFmpeg provenance and release gate](docs/compliance/ffmpeg.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
