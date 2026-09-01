# Staging and preview deployment

This guide describes the reproducible **staging/preview** path for the Phase 1 application. The Astro frontend is deployed as Cloudflare Workers Static Assets, while the Go API and LibreOffice office runner run separately under Docker Compose. Cloudflare Tunnel can publish the loopback-only API without exposing a directly routable origin address.

> **Release caveat:** staging and demo deployments are suitable for review, portfolio use, and controlled smoke testing. They are not a production-readiness claim. Production and tagged releases remain blocked until the FFmpeg WASM provenance evidence is complete. See the [license gate in the development guide](development.md#license-gate-before-release).

The intentionally public demo endpoints and their latest verification snapshot are listed in the [README live preview section](../README.md#live-preview). All reusable examples in this guide use reserved `example.invalid` hostnames and placeholder identifiers.

## Deployment model

```text
Browser
  |\
  | \-- LOCAL_ONLY: PNG, PDF, and video processing stays in the browser
  |
  \----> Cloudflare Workers Static Assets (static Astro frontend)
               |
               \----> https://api-staging.example.invalid
                           |
                           \----> Cloudflare Tunnel (optional connector path)
                                      |
                                      \----> 127.0.0.1:8080 (Go API in Compose)
                                                     |
                                                     \----> Unix socket -> office-runner
```

The frontend has no server-side Worker application code. Wrangler uploads the generated `apps/web/dist` directory as static assets. Only DOCX to PDF uses the API; PNG to JPG, Merge PDF, and Video to GIF remain browser-local.

## 1. Choose fixed staging origins

Use stable HTTPS origins for an end-to-end staging environment:

```dotenv
PUBLIC_APP_URL=https://staging.example.invalid
PUBLIC_API_URL=https://api-staging.example.invalid
API_ALLOWED_ORIGINS=https://staging.example.invalid
```

`PUBLIC_APP_URL` and `PUBLIC_API_URL` must be complete origins without credentials, a path, query, or fragment. Astro reads them at build time for canonical URLs, the sitemap, client configuration, and the CSP `connect-src` directive. The generated static files cannot be retargeted after the build.

`API_ALLOWED_ORIGINS` is a backend runtime variable. It must contain the exact frontend origin. It accepts a comma-separated list when more than one explicitly approved origin is necessary, for example local development plus a fixed staging origin:

```dotenv
API_ALLOWED_ORIGINS=http://localhost:4321,https://staging.example.invalid
```

Do not use `*`. CORS is not authentication, and an arbitrary versioned preview URL should not be added permanently to the allowlist. Perform full DOCX end-to-end tests on a fixed staging origin or another exact, deliberately approved origin.

Do not commit tunnel credentials, processor tokens, server addresses, or private hostnames. Copy `.env.example` to an ignored server-side file such as `.env.staging`, restrict its permissions, and populate sensitive values through the host's secret-management workflow.

## Environment variables

### Frontend build variables

| Variable          | Safe example                          | Purpose                                                                                    |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `PUBLIC_APP_NAME` | `AIO Converter`                       | Optional display and metadata name; not a secret.                                          |
| `PUBLIC_APP_URL`  | `https://staging.example.invalid`     | Exact frontend origin embedded in the static build. Required for CI and deployment builds. |
| `PUBLIC_API_URL`  | `https://api-staging.example.invalid` | Exact API origin embedded in the client and CSP. Required for CI and deployment builds.    |

These values belong in **Settings > Build > Build variables and secrets** for the applicable Workers Builds trigger. Build variables exist only while the build command runs. Adding the same names under Worker **Settings > Variables & Secrets**, or under `vars` in Wrangler configuration, does not make them available to Astro during the build.

Configure build variables separately for the production and preview triggers when both trigger types are enabled. Variable names are case-sensitive; store URL values without surrounding quotes.

### API and office-runner runtime variables

| Variable                     | Safe default/example              | Purpose and constraint                                                                                   |
| ---------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `API_ALLOWED_ORIGINS`        | `https://staging.example.invalid` | Exact-origin CORS allowlist; comma-separated when needed. Wildcard origins are rejected.                 |
| `API_ADDR`                   | `:8080`                           | API listener inside Compose. The Compose port mapping remains bound to `127.0.0.1`.                      |
| `API_METRICS_TOKEN`          | Inject from a secret manager      | Optional bearer token for trusted local metrics. Leave empty to disable `/metrics` with a 404 response.  |
| `API_PROCESSOR_TOKEN`        | Inject from a secret manager      | Shared token for API-to-runner calls. Use a non-empty secret in staging and never commit it.             |
| `API_JOB_ROOT`               | `/work/jobs`                      | Ephemeral API job root mounted as tmpfs by Compose.                                                      |
| `API_JOB_TTL`                | `15m`                             | Job retention window; the API accepts at most `15m`.                                                     |
| `API_PROCESS_TIMEOUT`        | `10m`                             | API job processing timeout; at most `15m`.                                                               |
| `API_DOWNLOAD_TIMEOUT`       | `10m`                             | One-time output download window; at most `15m`.                                                          |
| `API_SHUTDOWN_TIMEOUT`       | `15s`                             | Graceful API shutdown window; at most `1m`.                                                              |
| `API_MAX_CONCURRENT_JOBS`    | `1`                               | Active office jobs per API instance. Do not increase it without reviewing runner isolation and capacity. |
| `API_MAX_QUEUED_JOBS`        | `8`                               | Maximum queued jobs.                                                                                     |
| `API_MAX_UPLOAD_BYTES`       | `262144000`                       | Multipart request limit. Keep it bounded and large enough for the registered tool limit.                 |
| `API_PROCESSOR_SOCKET`       | `/run/aio-office/office.sock`     | Absolute Unix socket path used by the API; must end in `.sock`.                                          |
| `OFFICE_SOCKET_PATH`         | `/run/aio-office/office.sock`     | Office-runner socket path; must match the API path in Compose.                                           |
| `OFFICE_JOB_ROOT`            | `/work/office-jobs`               | Ephemeral LibreOffice work root mounted as tmpfs.                                                        |
| `LIBREOFFICE_BIN`            | `soffice`                         | LibreOffice executable inside the office-runner image.                                                   |
| `OFFICE_MAX_INPUT_BYTES`     | `52428800`                        | Maximum DOCX input size accepted by the runner.                                                          |
| `OFFICE_MAX_OUTPUT_BYTES`    | `268435456`                       | Maximum PDF output size accepted from the runner.                                                        |
| `OFFICE_PROCESS_TIMEOUT`     | `10m`                             | Per-job LibreOffice timeout; at most `15m`.                                                              |
| `OFFICE_MAX_CONCURRENT_JOBS` | `1`                               | Default runner concurrency. Higher values do not replace process and container isolation.                |
| `OFFICE_SHUTDOWN_TIMEOUT`    | `15s`                             | Runner cleanup window during shutdown; at most `1m`.                                                     |

`compose.yaml` passes `API_PROCESSOR_TOKEN` to the office runner as `OFFICE_PROCESSOR_TOKEN`. Use one injected shared value; do not create or commit a second plaintext token.

## 2. Build and deploy the static frontend

### Repository configuration

The staging deployment expects a repository-root `wrangler.jsonc` that targets the Astro output explicitly:

```jsonc
{
  "name": "aio-tools-converter",
  "compatibility_date": "2026-08-31",
  "assets": {
    "directory": "apps/web/dist",
  },
}
```

The Worker name in Cloudflare must match the Wrangler `name`. The config file must exist in the exact commit being built; retrying an older commit that predates the file will still fail.

Workers Static Assets supports the generated `_headers` file. Do not remove or override `apps/web/public/_headers`: it preserves the cross-origin isolation needed by browser workers and FFmpeg WASM, along with the existing security headers.

### Workers Builds settings

Connect the Git repository to the Worker and configure **Settings > Build** from the repository root:

| Setting                              | Value                                                         |
| ------------------------------------ | ------------------------------------------------------------- |
| Root directory                       | Repository root                                               |
| Build command                        | `pnpm --filter @aio-converter/web build`                      |
| Deploy command                       | `npx wrangler deploy --config ./wrangler.jsonc`               |
| Non-production branch deploy command | `npx wrangler versions upload --config ./wrangler.jsonc`      |
| Static asset directory               | Configured in `wrangler.jsonc`: `apps/web/dist`               |
| Production branch                    | The repository's intended integration branch, normally `main` |
| Non-production branch builds         | Enable only when branch preview versions are required         |

The explicit `--config` path is important in this pnpm monorepo. It prevents Wrangler's application-detection logic from treating the workspace root as an ambiguous collection of applications.

Set `PUBLIC_APP_URL` and `PUBLIC_API_URL` as Workers **Build variables** for every trigger that runs the Astro build. They are not Worker runtime bindings. A Cloudflare CI build sets CI indicators that activate the repository's public-origin guard, so missing build variables fail before Astro emits `dist`.

For a staging-like build in another CI shell, use placeholder origins and force the same validation:

```bash
PUBLIC_APP_URL=https://staging.example.invalid \
PUBLIC_API_URL=https://api-staging.example.invalid \
AIO_REQUIRE_PUBLIC_ORIGINS=1 \
pnpm --filter @aio-converter/web build
```

### Versions, previews, and active deployments

The two deploy commands have intentionally different effects:

- `wrangler deploy` creates a version and immediately makes it the active deployment serving production traffic.
- `wrangler versions upload` creates a version and a versioned preview URL without replacing the active deployment.

Use a preview URL for route, metadata, and static-asset checks before promotion. A custom domain continues to serve the previously active deployment until the new version is promoted or a production `wrangler deploy` succeeds. If a custom domain still shows an old `Hello World` response while the new preview is correct, inspect **Worker > Deployments** and confirm which version is active; rebuilding the Astro app is not the remedy for an inactive version.

Versioned preview URLs use a different origin from the fixed staging custom domain. Because the API uses exact-origin CORS, do not weaken the allowlist merely to make arbitrary preview versions submit DOCX jobs. Promote a verified version to the fixed staging deployment before running the full API smoke test.

Relevant Cloudflare references:

- [Workers Static Assets configuration](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Workers versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Workers preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
- [Static asset custom headers](https://developers.cloudflare.com/workers/static-assets/headers/)

## 3. Deploy the API and office runner

On the approved Linux host with Docker Compose, check out the staging revision and create a server-only environment file:

```bash
cp .env.example .env.staging
chmod 600 .env.staging
# Populate .env.staging through the host's editor or secret workflow, not through Git.

docker compose --env-file .env.staging up --build -d
docker compose --env-file .env.staging ps
curl --fail --show-error http://127.0.0.1:8080/healthz
```

The expected response is JSON containing `"status":"ok"`. API health also checks office-runner readiness over the Unix socket. A `200` response therefore shows that both services are ready to accept a DOCX job, but it does not prove that LibreOffice can successfully convert a document. Run the synthetic DOCX smoke test before declaring the staging flow healthy.

Preserve the current Compose security boundary:

- The API port is published only on `127.0.0.1:8080`, not `0.0.0.0`.
- `office-runner` publishes no port and uses `network_mode: none`.
- API jobs and office work directories are tmpfs, not persistent user-file volumes.
- The `office-socket` volume is tmpfs IPC storage, not user-file storage.
- Both services remain non-root with read-only filesystems, dropped capabilities, `no-new-privileges`, and resource limits.

`/metrics` is disabled by default. If trusted local monitoring needs it, set `API_METRICS_TOKEN` only through the server secret workflow and send `Authorization: Bearer <token>` from the monitoring client. Do not publish the path through the public API hostname, and do not configure access logs to retain filenames, multipart bodies, query strings, authorization values, or user output.

## 4. Publish the API through Cloudflare Tunnel (optional)

Cloudflare calls the persistent Cloudflare object a **tunnel** and each running `cloudflared` process a **connector**. A remotely managed tunnel stores its configuration in Cloudflare; a locally managed tunnel stores configuration and a credentials file on the connector host. Both models use outbound-only connector connections, so the API can remain bound to loopback.

The following locally managed example contains placeholders only:

```yaml
# /etc/cloudflared/config.yml
tunnel: 00000000-0000-0000-0000-000000000000
credentials-file: /etc/cloudflared/00000000-0000-0000-0000-000000000000.json

ingress:
  - hostname: api-staging.example.invalid
    path: ^/metrics$
    service: http_status:404
  - hostname: api-staging.example.invalid
    service: http://127.0.0.1:8080
  - service: http_status:404
```

Ingress configurations must end with a catch-all rule. Validate and test the local rules before starting the connector:

```bash
cloudflared --config /etc/cloudflared/config.yml tunnel ingress validate
cloudflared --config /etc/cloudflared/config.yml tunnel ingress rule https://api-staging.example.invalid
cloudflared --config /etc/cloudflared/config.yml tunnel run aio-tools-staging
```

For a remotely managed tunnel, install the connector using the Cloudflare dashboard instructions and store its token in the host's service manager or secret store. Do not place the token in `config.yml`, `.env.example`, Git, tickets, screenshots, shell history, or logs. Do not add `noTLSVerify`; this example intentionally connects `cloudflared` to a local plain-HTTP loopback service while Cloudflare terminates public HTTPS.

Cloudflare references:

- [Cloudflare Tunnel terminology](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/tunnel-useful-terms/)
- [Locally managed tunnel configuration files](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/)

## 5. Verify CORS, CSP, and response headers

`PUBLIC_API_URL` controls the frontend CSP `connect-src`; `API_ALLOWED_ORIGINS` controls the API's exact-origin CORS response. They must describe the same approved staging pair.

Run an API preflight from a machine that can reach the public API hostname:

```bash
curl --include --request OPTIONS https://api-staging.example.invalid/v1/jobs/document.docx-to-pdf \
  --header 'Origin: https://staging.example.invalid' \
  --header 'Access-Control-Request-Method: POST' \
  --header 'Access-Control-Request-Headers: content-type'
```

Verify:

- HTTP `204`.
- `Access-Control-Allow-Origin: https://staging.example.invalid`.
- `Vary: Origin`.
- `Cache-Control: private, no-store`.

Do not add wildcard CORS, a response-header rewrite, or a weaker CSP as a workaround. If the allowlist changes, recreate the API container so it receives the new environment rather than only restarting the existing container:

```bash
docker compose --env-file .env.staging up -d --no-deps --force-recreate api
docker compose --env-file .env.staging exec -T api printenv API_ALLOWED_ORIGINS
```

Check that the frontend still serves the repository's security headers:

```bash
curl --head https://staging.example.invalid/
curl --head https://staging.example.invalid/wasm/ffmpeg/ffmpeg-core.wasm.gz
```

Confirm the expected COOP, COEP, CORP, referrer, content-type, frame, and permissions policies. The WASM path should also retain its bounded cache policy.

## 6. Smoke-test staging

Export placeholders only in the operator shell, replacing them at execution time with the approved staging origins:

```bash
export PUBLIC_APP_URL=https://staging.example.invalid
export PUBLIC_API_URL=https://api-staging.example.invalid
```

### Routes and API health

```bash
for route in / /image/png-to-jpg /pdf/merge-pdf /video/video-to-gif /document/docx-to-pdf; do
  curl --fail --show-error --silent --location --output /dev/null "$PUBLIC_APP_URL$route"
done

curl --fail --show-error --silent "$PUBLIC_API_URL/healthz"
```

Check page titles, canonical URLs, and the final redirected URLs as well as status codes. Workers Static Assets may canonicalize Astro directory pages to trailing-slash URLs.

### DOCX-to-PDF API smoke test

Use a synthetic, non-sensitive document such as `./staging-smoke.docx`. The following Bash flow requires `jq`, creates an ephemeral job, waits for success, performs the one-time output download, and verifies the PDF signature:

```bash
job_id="$(
  curl --fail-with-body --show-error --silent \
    --request POST "$PUBLIC_API_URL/v1/jobs/document.docx-to-pdf" \
    --header "Origin: $PUBLIC_APP_URL" \
    --form 'file=@./staging-smoke.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document' \
  | jq -er '.jobId'
)"

status='queued'
for _ in $(seq 1 120); do
  response="$(curl --fail-with-body --show-error --silent \
    --header "Origin: $PUBLIC_APP_URL" \
    "$PUBLIC_API_URL/v1/jobs/$job_id")"
  status="$(printf '%s' "$response" | jq -er '.status')"
  case "$status" in
    succeeded) break ;;
    failed|canceled|timed_out)
      printf 'DOCX job ended with status: %s\n' "$status" >&2
      exit 1
      ;;
  esac
  sleep 1
done

test "$status" = succeeded
curl --fail-with-body --show-error --silent \
  --header "Origin: $PUBLIC_APP_URL" \
  --output staging-smoke.pdf \
  "$PUBLIC_API_URL/v1/jobs/$job_id/output"
test "$(head -c 5 staging-smoke.pdf)" = '%PDF-'
```

The output is downloadable only once. If the command fails or times out, proceed to cleanup and log inspection without copying document contents into logs or tickets. The browser smoke test should additionally confirm that Server-Sent Events report job progress and completion.

### Browser smoke matrix

Open DevTools Network and test only synthetic, non-sensitive files:

| Tool         | Expected result                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| PNG to JPG   | Process one PNG and a small batch, download JPG/ZIP results, and confirm that no `/v1/jobs` request occurs.                                 |
| Merge PDF    | Upload two PDFs, reorder them, process, and confirm that output page order matches the queue without any `/v1/jobs` request.                |
| Video to GIF | Process a short video and download a GIF. Confirm that FFmpeg/worker assets load from the frontend origin and no `/v1/jobs` request occurs. |
| DOCX to PDF  | Process `staging-smoke.docx`, observe the API and SSE requests, download the PDF once, and confirm private/no-store response handling.      |

At approximately 390 px mobile width and 1440 px desktop width, also verify:

- No horizontal overflow.
- Every upload form renders.
- The skip link and keyboard focus behavior work.
- Homepage tool links reach the intended routes.
- Privacy copy distinguishes browser-local processing from server-ephemeral DOCX processing.
- The DOCX request target is the configured API origin, not localhost or the frontend origin.

### Controlled fault checks

Run these only in a staging maintenance window. They intentionally interrupt DOCX-to-PDF, but do not affect the browser-local tools or require Cloudflare configuration changes.

To verify office-runner recovery, stop the runner and confirm that the API readiness endpoint reports the dependency as unavailable:

```bash
docker compose --env-file .env.staging stop office-runner
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' "$PUBLIC_API_URL/healthz"
# Expected: 503
```

While it is stopped, submit `staging-smoke.docx` with the DOCX API flow above. The accepted job must reach `failed` with the public `processor_unavailable` error code, without a filename or filesystem path in the response. Confirm both temporary-job locations are empty, start the runner, wait for `/healthz` to return `200`, then repeat the normal DOCX smoke test successfully:

```bash
docker compose --env-file .env.staging start office-runner
until curl --fail --silent --output /dev/null "$PUBLIC_API_URL/healthz"; do sleep 1; done
```

To verify the intentionally in-memory API restart model, create a successful DOCX job with the smoke flow but pause before requesting its output. Restart the API, wait for `/healthz` to return `200`, then request that old job's output URL. It must return `404`, never expose the previous PDF, and both temporary-job locations must be empty. Repeat with a newly accepted, still-processing job to confirm it also disappears safely after the restart. Finally, run a fresh DOCX smoke test to prove recovery:

```bash
docker compose --env-file .env.staging restart api
until curl --fail --silent --output /dev/null "$PUBLIC_API_URL/healthz"; do sleep 1; done
```

### Cleanup and log verification

After completion, cancellation, or timeout, verify that the tmpfs job areas are empty and logs contain no file content:

```bash
docker compose --env-file .env.staging exec api find /work/jobs -mindepth 1 -maxdepth 1 -print
docker compose --env-file .env.staging exec office-runner find /work/office-jobs -mindepth 1 -maxdepth 1 -print
docker compose --env-file .env.staging logs --since 15m api office-runner
```

The `find` commands should produce no job artifacts after lifecycle cleanup. Review logs only for aggregate status, health, and safe errors. Do not copy user files or sensitive request data into issue trackers, analytics, or external log stores.

The API emits structured lifecycle records for queued and terminal jobs, plus a safe cleanup-retry warning if artifact removal fails. These records include the random job ID, tool ID, terminal status, duration, and public error code only; they intentionally omit filenames, document content, tokens, and filesystem paths.

## Staging checklist

- [ ] The deployed commit contains the repository-root `wrangler.jsonc` and its Worker name matches the Cloudflare project.
- [ ] Workers Build Variables provide exact `PUBLIC_APP_URL` and `PUBLIC_API_URL` values to every applicable build trigger.
- [ ] Production deploys use `wrangler deploy`; non-production branch builds use `wrangler versions upload` and do not replace the active deployment.
- [ ] Workers Static Assets serves `/`, all four tool routes, the generated 404, and the existing security headers.
- [ ] API and `office-runner` are healthy in Compose; the API remains bound to loopback on the host.
- [ ] The Tunnel connector is healthy, uses an exact public hostname, and stores no token or credentials in the repository.
- [ ] CORS preflight returns the exact frontend origin and API responses retain `private, no-store`.
- [ ] `/metrics` is disabled unless a trusted monitoring token is configured; the Tunnel rejects the public metrics path.
- [ ] DOCX to PDF creates an ephemeral job, receives SSE progress, produces a valid PDF, and permits only one output download.
- [ ] PNG to JPG, Merge PDF, and Video to GIF complete without `/v1/jobs` requests.
- [ ] Job tmpfs directories are clean after success, cancellation, timeout, and restart; logs contain no user-file data.
- [ ] Mobile and desktop checks show no horizontal overflow and all upload forms remain usable.
- [ ] The environment is labeled staging/demo, with no production or tagged-release claim while FFmpeg provenance remains unresolved.

## Before any release

Run the quality gates from the repository root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

A healthy staging deployment does not replace the compliance gate. Do not create a production/tagged release or describe this repository as production-ready until the FFmpeg WASM provenance evidence is complete and the compliance gate is no longer blocked.
