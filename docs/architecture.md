# Phase 1 architecture

AIO Converter is registry-driven. Every tool is described by the same typed tool registry and rendered through the same Converter Workspace. The `ToolShell` UI state machine does not import conversion libraries directly; it receives a `JobExecutor` and consumes a consistent set of `ProcessOutput` objects. The `apps/web` composition layer selects the correct browser or server executor from the registered execution mode and processor ID.

Phase 1 intentionally supports two execution modes:

- `LOCAL_ONLY` keeps user files in the browser and has no API fallback.
- `SERVER_EPHEMERAL` sends a file to a short-lived server job when conversion requires a native application.

`REMOTE_FETCH` exists in the shared type model but is not part of Phase 1.

Office-processor transport is explicit: Unix sockets remain the default for
local Compose, while authenticated TCP is available only for trusted private
container networks. There is no automatic fallback between transports.

## Module boundaries

| Module or runtime boundary                | Responsibility                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/tool-core`                      | Shared tool and processor contracts, file and option validation, execution modes, and user-safe errors.       |
| `packages/tool-registry`                  | Source of truth for routes, metadata, privacy modes, limits, options, processor IDs, presets, and validation. |
| `packages/browser-processors`             | Image, PDF, FFmpeg, archive, worker protocol, worker lifecycle, and browser executor implementations.         |
| `packages/server-contracts`               | Typed server-job responses, SSE parsing, cancellation, cleanup requests, and the server `JobExecutor`.        |
| `packages/shared`                         | UI-independent byte, MIME-type, file-extension, and output-filename helpers.                                  |
| `packages/ui`                             | Converter Workspace components, accessibility behavior, edge states, and the `ToolShell` state machine.       |
| `apps/web`                                | Astro static routes, React composition, executor selection, browser-worker entry points, metadata, and CSP.   |
| `apps/api` — API binary                   | Streaming uploads, in-memory job lifecycle, queueing, SSE, cancellation, one-time output, and cleanup.        |
| `apps/api` — office-worker binary         | LibreOffice conversion behind a Unix socket, with isolated temporary storage and process control.             |
| Docker Compose `office-runner` service    | Runs the office-worker and LibreOffice without a network interface and with constrained container privileges. |
| Cloudflare Workers Static Assets / Tunnel | Serves the static staging frontend and forwards the staging API hostname to the loopback-only Docker API.     |

## Phase 1 execution map

| Tool         | Registry mode      | Processor ID          | Runtime boundary                                  |
| ------------ | ------------------ | --------------------- | ------------------------------------------------- |
| PNG to JPG   | `LOCAL_ONLY`       | `image-convert`       | Browser worker or browser main-thread fallback    |
| Merge PDF    | `LOCAL_ONLY`       | `pdf-merge`           | Browser worker                                    |
| Video to GIF | `LOCAL_ONLY`       | `ffmpeg-video-to-gif` | Browser worker with the local FFmpeg WASM runtime |
| DOCX to PDF  | `SERVER_EPHEMERAL` | `office-docx-to-pdf`  | Go API and isolated LibreOffice office runner     |

The PNG-to-JPG executor can fall back to a main-thread browser implementation when the required `OffscreenCanvas` API is unavailable. This remains browser-local and never becomes a server fallback.

## Browser-local path

```text
File picker or drop zone
  -> extension, declared MIME type, and magic-byte validation
  -> option validation
  -> dedicated Web Worker, or the documented image-only browser fallback
  -> ProcessOutput Blob
  -> object URL or ZIP download
  -> revoke object URL, terminate worker, and release resources
```

PNG-to-JPG batch output is archived through a separate browser worker. Merge PDF preserves the queue order selected by the user. Video to GIF loads the local FFmpeg WASM runtime inside the browser processing boundary.

There is no API fallback for a `LOCAL_ONLY` tool. Unsupported browser capabilities, codec failures, cancellation, and timeouts terminate locally and are mapped to user-safe errors.

## Server-ephemeral path

```text
Browser
  -> multipart POST to the Go API
  -> random API job directory in tmpfs
  -> queued in-memory job with an absolute deadline
  -> HTTP over the configured Unix socket (default) or private TCP endpoint
  -> network-disabled office-runner container
  -> temporary office-runner job directory in tmpfs
  -> LibreOffice subprocess in its own process group
  -> validated PDF streamed back to the API
  -> SSE terminal status and one-time output download
  -> remove input, output, and both temporary job directories
```

The API owns the `toolId -> processor` mapping; the client cannot select a binary or arbitrary processor. Job metadata exists only in memory. The API removes the input after processing. It removes the output after its first download, cancellation, failure, timeout, shutdown, or the configured TTL, whose accepted maximum is 15 minutes.

Queued jobs also have an absolute deadline. If filesystem cleanup fails, the failure remains eligible for another cleanup attempt by the sweeper. The office runner has no published port and uses `network_mode: none` in the existing Compose deployment. TCP mode is intended only for a separate private container network, requires processor-token authentication, and must never be exposed to the public Internet.

## Privacy and security invariants

- Browser-local user files are not sent to the job API, and no silent server fallback exists.
- User file contents are not stored in a database, object storage, CDN cache, analytics, or application logs.
- The original filename is used briefly for extension validation but is not stored in server job metadata.
- API file responses use `Cache-Control: private, no-store`.
- Browser outputs use object URLs that are revoked during reset or unmount.
- Registry validation rejects a `LOCAL_ONLY` tool mapped to a server processor and a `SERVER_EPHEMERAL` tool mapped to a browser processor.
- A service worker is not used to intercept or cache user-file requests or responses.
- The office runner remains non-root, read-only, network-disabled, capability-dropped, and backed by temporary scratch storage.

These controls define the product's processing boundary; they are not a blanket regulatory or data-handling certification.

## Staging topology

The current preview environment publishes `apps/web/dist` through Cloudflare Workers Static Assets. Build-time `PUBLIC_APP_URL` and `PUBLIC_API_URL` values establish the canonical frontend origin, API endpoint, and CSP `connect-src` boundary.

```text
Cloudflare Workers static frontend
  |\
  | \-- LOCAL_ONLY tools -> browser processors and browser downloads
  |
  \---- SERVER_EPHEMERAL DOCX job
          -> exact-origin CORS API hostname
          -> Cloudflare Tunnel
          -> 127.0.0.1:8080 Docker Compose API
          -> Unix socket
          -> network-disabled office-runner
```

The API remains bound to loopback and is not published directly on `0.0.0.0`. `API_ALLOWED_ORIGINS` contains the exact approved frontend origins; wildcard CORS is not part of the architecture. Tunnel credentials, processor tokens, server addresses, and local environment files remain outside the repository.

This topology is a staging and portfolio preview, not a production-release claim. A production or tagged release remains blocked until the FFmpeg WASM provenance requirement is resolved. Deployment steps and operational checks are documented in [deployment.md](deployment.md).

## Adding a tool

For a new variant backed by an existing engine, add a tool definition to the registry and use an appropriate typed processor preset. For example, an image preset defines the input and output MIME types, output extension, and transparency-flattening behavior; the engine is not hard-coded to a single PNG-to-JPG route.

The registry then drives the route, metadata, breadcrumb, privacy badge, initial validation, options, and related-tool presentation. A new processor must still implement the shared `JobExecutor` contract and be added to the processor manifest so build-time validation can detect missing or invalid mappings.
