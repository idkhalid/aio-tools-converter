# Development

## Prasyarat

- Node.js 22.14 atau lebih baru
- Corepack dan pnpm 11
- Go 1.24 atau lebih baru
- Docker Compose untuk DOCX-to-PDF end-to-end
- Chromium Playwright untuk E2E

## Setup awal

```bash
corepack enable
pnpm install
pnpm exec playwright install chromium
```

Salin `.env.example` menjadi `.env` bila perlu mengubah origin, URL API, limit, atau timeout. Nilai bawaan source hanya ditujukan untuk development lokal.

## Menjalankan aplikasi

Frontend lokal (tiga tool `LOCAL_ONLY` langsung dapat digunakan):

```bash
pnpm dev
```

Agar DOCX-to-PDF benar-benar berjalan melalui LibreOffice terisolasi, jalankan frontend bersama stack container:

```bash
pnpm dev:docker
```

Atau jalankan backend saja:

```bash
pnpm dev:api
```

`office-runner` ikut dimulai sebagai dependency dan tidak memublikasikan port atau memiliki akses network.

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

API Go dapat diuji terpisah tanpa LibreOffice pada host karena integration test memakai processor yang diinjeksi:

```bash
cd apps/api
go test ./...
```

`pnpm test:e2e` mengharuskan Docker karena mencakup server tool. Untuk audit browser-only ketika Docker tidak tersedia, set `PLAYWRIGHT_SKIP_API_SERVER=1`; hasil tersebut tidak menggantikan smoke test DOCX container.

## Kompatibilitas browser

| Jalur        | Kebutuhan minimum                                                    | Catatan                                                                                                   |
| ------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| PNG to JPG   | Web Worker, `createImageBitmap`, dan `OffscreenCanvas.convertToBlob` | Diuji di Chromium desktop/mobile; browser tanpa codec worker mendapat error lokal, tanpa upload fallback. |
| Merge PDF    | Web Worker, Blob, dan ArrayBuffer                                    | Tidak bergantung pada server.                                                                             |
| Video to GIF | WebAssembly, Web Worker, Blob URL, dan memori perangkat yang cukup   | Cold start mengunduh core terkompresi sekitar 10 MiB.                                                     |
| DOCX to PDF  | Fetch, multipart, dan SSE                                            | Membutuhkan API serta `office-runner`; fidelity mengikuti LibreOffice/font container.                     |

Target build Astro saat ini mencakup Chrome/Edge 111, Firefox 114, dan Safari/iOS 16.4 atau yang lebih baru. E2E otomatis Phase 1 memakai Chromium; uji manual Safari/Firefox tetap diperlukan sebelum menyatakan dukungan produksi lintas-browser.

## Runtime FFmpeg

Core FFmpeg dimuat secara lazy saat tool Video to GIF dijalankan. Vite menerbitkan entry ESM `@ffmpeg/core` sebagai asset build yang dapat di-import worker, sedangkan script web hanya meng-gzip WASM dari dependency ke `apps/web/public/wasm` sebelum dev/build. Browser worker baru mengambil dan membuka `.wasm.gz` saat tool dijalankan; loader menerima byte gzip maupun WASM yang sudah didekode transparan oleh development server. Raw WASM 32 MiB tidak masuk output deployment dan folder hasil generasi tidak perlu disimpan di Git.

## Batas Phase 1

- PNG transparan diratakan ke warna background yang dipilih saat menjadi JPG.
- Merge PDF menolak input encrypted atau rusak; tidak ada repair diam-diam.
- Video to GIF dibatasi untuk clip pendek karena FFmpeg WebAssembly memakai RAM perangkat.
- DOCX-to-PDF tidak menjamin layout identik dengan Microsoft Word; hasil mengikuti font dan kemampuan LibreOffice di image runner.
- UI saat ini adalah skin dasar yang mobile-first dan keyboard-accessible. Visual final dapat diganti tanpa memindahkan engine.

## Gate lisensi sebelum rilis

Runtime prebuilt `@ffmpeg/core` yang dipakai Phase 1 mendeklarasikan `GPL-2.0-or-later`. Proyek ini tetap `UNLICENSED` sampai pemilik menentukan lisensi, jadi Video to GIF tidak boleh dirilis tanpa keputusan compliance yang eksplisit. Lihat `THIRD_PARTY_NOTICES.md`; opsi teknisnya adalah memenuhi kewajiban distribusi GPL atau mengganti runtime dengan custom build FFmpeg LGPL-only yang sudah diaudit.
