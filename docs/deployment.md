# Deployment

## Frontend statis

Build frontend dari root repository:

```bash
pnpm install --frozen-lockfile
pnpm --filter @aio-converter/web build
```

Output berada di `apps/web/dist`. Untuk Cloudflare Pages, gunakan root repository sebagai build root, command di atas sebagai build command, dan `apps/web/dist` sebagai output directory. Atur minimal:

```dotenv
PUBLIC_APP_NAME=AIO Converter
PUBLIC_APP_URL=https://converter.example.com
PUBLIC_API_URL=https://api.example.com
```

File `public/_headers` mengaktifkan header isolasi lintas-origin yang dibutuhkan runtime worker/FFmpeg serta baseline security headers. Verifikasi header tersebut juga pada preview deployment sebelum menjalankan media tool.

Prebuild menyimpan FFmpeg WASM sebagai `ffmpeg-core.wasm.gz`; browser worker membukanya secara lazy menjadi Blob URL. Core JavaScript diterbitkan Vite sebagai asset `_astro/ffmpeg-core-*.js`, bukan disalin ke folder `public`. Ini menjaga raw runtime 32 MiB di luar output dan membuat asset deploy tetap di bawah batas satu file Cloudflare Pages. Periksa ukuran hasil build lagi setiap kali versi FFmpeg berubah.

Astro menghasilkan CSP dengan hash untuk script hydration dan menggabungkan `PUBLIC_API_URL` ke `connect-src` pada saat build. Karena itu URL production harus diisi sebelum build, bukan diganti setelah folder `dist` dibuat. Build dengan `CI=true`, `CF_PAGES=1`, atau `AIO_REQUIRE_PUBLIC_ORIGINS=1` akan gagal bila `PUBLIC_APP_URL`/`PUBLIC_API_URL` belum diatur, sehingga canonical atau API localhost tidak bisa terbit diam-diam.

## Processing backend

Backend memerlukan host Linux/container yang mendukung tmpfs dan resource limits:

```bash
docker compose up --build -d api
```

Pasang reverse proxy HTTPS di depan `127.0.0.1:8080`. Route `/v1/jobs/*` tidak boleh dicache atau diberi request logging yang merekam multipart body, filename, maupun query sensitif. Set `API_ALLOWED_ORIGINS` ke origin frontend yang persis; wildcard tidak diterima.

Endpoint `/metrics` hanya berisi counter/gauge agregat (failure, timeout, antrean, durasi processor, dan memori proses). Batasi endpoint ini ke jaringan monitoring pada reverse proxy; jangan mengeksposnya sebagai bagian katalog publik.

Jangan menambahkan persistent volume untuk `/work/jobs`, `/work/office-jobs`, atau output. Named volume `office-socket` hanya menjadi kanal Unix socket dan memakai tmpfs; ia bukan lokasi file pengguna.

Default Phase 1 menjalankan satu LibreOffice job pada satu waktu agar dua dokumen tidak tepercaya tidak berbagi runner secara bersamaan. Tambah throughput dengan beberapa instance runner satu-job yang disposable/terisolasi; jangan sekadar menaikkan `OFFICE_MAX_CONCURRENT_JOBS` pada container yang sama tanpa sandbox per-job tambahan.

## Verifikasi sebelum produksi

1. Jalankan lint, typecheck, unit/integration test, build, dan Playwright.
2. Konversi DOCX sintetis melalui Compose dan pastikan output PDF dapat dibuka.
3. Uji success, cancel, timeout, disconnect saat download, dan restart; direktori job harus kembali kosong.
4. Pastikan `office-runner` non-root, read-only, `cap_drop: ALL`, `no-new-privileges`, tidak memiliki published port, dan `network_mode: none`.
5. Pastikan response API mengandung `Cache-Control: private, no-store` dan CORS hanya untuk frontend resmi.
6. Pastikan request file `LOCAL_ONLY` tidak pernah menuju `/v1/jobs`.

API sengaja tidak ditempatkan di Cloudflare Pages Functions: LibreOffice memerlukan container terisolasi dan resource/runtime yang berbeda dari frontend statis.
