# Staging and preview deployment

Dokumen ini menjelaskan jalur deployment **staging/preview** yang dapat diulang untuk Phase 1. Frontend statis di-host terpisah dari API Go dan runner LibreOffice. Jangan gunakan dokumen ini untuk menyatakan rilis produksi atau tagged release.

> **Release caveat:** staging/demo boleh dipakai untuk preview dan portfolio. Rilis produksi tetap diblokir sampai provenance FFmpeg WASM memiliki bukti yang lengkap. Lihat [gate lisensi di development guide](development.md#gate-lisensi-sebelum-rilis).

## Topologi staging

```text
Browser
  |\
  | \-- LOCAL_ONLY: PNG, PDF, dan video diproses di browser
  |
  \----> Cloudflare Pages (frontend statis)
               |
               \----> https://api-staging.example.invalid
                           |
                           \----> Cloudflare Tunnel (opsional)
                                      |
                                      \----> 127.0.0.1:8080 (API Go + Compose)
                                                     |
                                                     \----> Unix socket -> office-runner
```

`staging.example.invalid` dan `api-staging.example.invalid` di bawah ini adalah placeholder. Ganti hanya pada secret manager, environment build provider, atau file environment di server yang tidak di-commit.

## 1. Tetapkan origin staging

Gunakan dua origin HTTPS tetap untuk staging. Jangan gunakan wildcard CORS atau URL preview acak sebagai canonical origin.

```dotenv
PUBLIC_APP_URL=https://staging.example.invalid
PUBLIC_API_URL=https://api-staging.example.invalid
API_ALLOWED_ORIGINS=https://staging.example.invalid
```

`PUBLIC_APP_URL` dan `PUBLIC_API_URL` harus berupa origin lengkap tanpa path, query, fragment, atau kredensial. URL ini dibaca saat build: Astro menggunakannya untuk canonical URL, sitemap, dan CSP `connect-src`. `API_ALLOWED_ORIGINS` adalah nama variabel yang benar; nilainya harus origin frontend yang persis dan dapat berupa daftar CSV bila benar-benar ada lebih dari satu origin staging yang disetujui.

Jangan menaruh URL staging nyata, token, IP VPS, atau kredensial tunnel di Git. Salin `.env.example` menjadi file yang diabaikan Git, misalnya `.env.staging`, lalu berikan permission terbatas pada file itu di VPS.

## Environment variables

| Variable                     | Contoh staging aman                   | Kegunaan dan batas                                                                                                            |
| ---------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_APP_NAME`            | `AIO Converter`                       | Nama UI/metadata; bukan secret.                                                                                               |
| `PUBLIC_APP_URL`             | `https://staging.example.invalid`     | Origin frontend yang dibangun ke output statis. Wajib untuk build deployment.                                                 |
| `PUBLIC_API_URL`             | `https://api-staging.example.invalid` | Origin API yang dimasukkan ke client dan CSP. Wajib untuk build deployment.                                                   |
| `API_ALLOWED_ORIGINS`        | `https://staging.example.invalid`     | Allowlist CORS exact-origin, CSV bila diperlukan. Jangan gunakan `*`.                                                         |
| `API_ADDR`                   | `:8080`                               | Listener internal Compose; port tetap dipublish hanya ke `127.0.0.1`.                                                         |
| `API_PROCESSOR_TOKEN`        | disuntikkan oleh secret manager       | Token bersama API dan office runner. Kosong hanya untuk development lokal yang terisolasi. Jangan commit nilainya.            |
| `API_JOB_ROOT`               | `/work/jobs`                          | Root job sementara API. Compose memasangnya sebagai tmpfs, bukan volume persisten.                                            |
| `API_JOB_TTL`                | `15m`                                 | TTL job; maksimum yang diterima API adalah `15m`.                                                                             |
| `API_PROCESS_TIMEOUT`        | `10m`                                 | Batas proses job; maksimum `15m`.                                                                                             |
| `API_DOWNLOAD_TIMEOUT`       | `10m`                                 | Batas download satu kali; maksimum `15m`.                                                                                     |
| `API_SHUTDOWN_TIMEOUT`       | `15s`                                 | Batas graceful shutdown API; maksimum `1m`.                                                                                   |
| `API_MAX_CONCURRENT_JOBS`    | `1`                                   | Job office aktif per API. Jangan menaikkannya tanpa isolasi runner tambahan.                                                  |
| `API_MAX_QUEUED_JOBS`        | `8`                                   | Panjang antrean maksimum.                                                                                                     |
| `API_MAX_UPLOAD_BYTES`       | `262144000`                           | Batas multipart API; harus cukup untuk batas tool tetapi tetap dibatasi.                                                      |
| `API_PROCESSOR_SOCKET`       | `/run/aio-office/office.sock`         | Unix socket API ke office runner; harus absolute dan berakhiran `.sock`.                                                      |
| `OFFICE_SOCKET_PATH`         | `/run/aio-office/office.sock`         | Socket office runner; harus sama dengan socket API di Compose.                                                                |
| `OFFICE_JOB_ROOT`            | `/work/office-jobs`                   | Root kerja LibreOffice sementara di tmpfs.                                                                                    |
| `LIBREOFFICE_BIN`            | `soffice`                             | Binary LibreOffice di image office runner.                                                                                    |
| `OFFICE_MAX_INPUT_BYTES`     | `52428800`                            | Batas input DOCX untuk runner.                                                                                                |
| `OFFICE_MAX_OUTPUT_BYTES`    | `268435456`                           | Batas output PDF dari runner.                                                                                                 |
| `OFFICE_PROCESS_TIMEOUT`     | `10m`                                 | Batas LibreOffice per job; maksimum `15m`.                                                                                    |
| `OFFICE_MAX_CONCURRENT_JOBS` | `1`                                   | Satu job per runner default; maksimum yang diterima runner adalah `32`, tetapi nilai lebih tinggi tidak menggantikan isolasi. |
| `OFFICE_SHUTDOWN_TIMEOUT`    | `15s`                                 | Batas cleanup runner saat shutdown; maksimum `1m`.                                                                            |

Compose yang ada meneruskan `API_PROCESSOR_TOKEN` yang sama sebagai `OFFICE_PROCESSOR_TOKEN` ke runner. Jangan membuat token runner kedua atau menaruh salah satu nilainya di repository.

`.env.example` adalah referensi default lokal yang aman untuk di-commit. Nilai staging nyata hanya boleh berada di secret store provider atau file environment VPS yang tidak di-commit.

## 2. Build dan deploy frontend statis

### Cloudflare Pages

Buat project Pages dari repository Git dan gunakan konfigurasi berikut.

| Setting                | Nilai                                               |
| ---------------------- | --------------------------------------------------- |
| Root directory         | root repository                                     |
| Install command        | `corepack enable && pnpm install --frozen-lockfile` |
| Build command          | `pnpm --filter @aio-converter/web build`            |
| Build output directory | `apps/web/dist`                                     |
| Node.js                | `22.14` atau lebih baru sesuai `package.json`       |

Tambahkan `PUBLIC_APP_URL` dan `PUBLIC_API_URL` sebagai environment variable build untuk environment preview/staging yang bersangkutan. Cloudflare Pages menyediakan branch preview, tetapi gunakan custom domain staging yang stabil bila deployment tersebut akan diuji end-to-end; canonical URL dan CSP tidak dapat diganti setelah `dist` dibuat.

Untuk build yang dijalankan di shell CI/staging, gunakan guard berikut agar origin tidak kembali ke localhost:

```bash
PUBLIC_APP_URL=https://staging.example.invalid \
PUBLIC_API_URL=https://api-staging.example.invalid \
AIO_REQUIRE_PUBLIC_ORIGINS=1 \
pnpm --filter @aio-converter/web build
```

Jangan ubah atau menimpa `apps/web/public/_headers`. Header tersebut mempertahankan cross-origin isolation untuk browser worker/FFmpeg, serta header keamanan statis. Jangan tambahkan proxy Pages Function untuk API: frontend ini statis dan API LibreOffice membutuhkan container terisolasi.

Cloudflare Pages documentation: <https://developers.cloudflare.com/pages/configuration/build-configuration/>.

## 3. Deploy API dan office runner di VPS

Di VPS Linux yang memiliki Docker Compose, clone checkout staging dan buat file environment yang tidak di-commit.

```bash
cp .env.example .env.staging
chmod 600 .env.staging
# Edit .env.staging melalui editor/server secret workflow, bukan melalui Git.

docker compose --env-file .env.staging up --build -d
docker compose --env-file .env.staging ps
curl --fail --show-error http://127.0.0.1:8080/healthz
```

Response health yang diharapkan adalah JSON dengan `"status":"ok"`. Health API juga memeriksa readiness office runner melalui Unix socket, sehingga `200` berarti kedua service siap menerima DOCX job. Ini belum membuktikan LibreOffice berhasil mengonversi dokumen; lakukan smoke test DOCX di bawah sebelum menyatakan staging siap diuji.

Pertahankan struktur Compose yang ada:

- API hanya dipublish ke `127.0.0.1:8080`; jangan publikasi langsung ke `0.0.0.0`.
- `office-runner` tidak memiliki published port dan menggunakan `network_mode: none`.
- Root job dan output berada di tmpfs; jangan menambahkan persistent volume untuk `/work/jobs` atau `/work/office-jobs`.
- Socket `office-socket` adalah tmpfs untuk IPC, bukan storage file pengguna.
- Pertahankan `read_only`, `cap_drop: ALL`, `no-new-privileges`, limit PID/memori/CPU, dan user non-root yang sudah ada.

`/metrics` hanya untuk jaringan monitoring yang dipercaya. Jangan publish endpoint tersebut melalui public hostname atau logging layer yang dapat menyimpan nama file, multipart body, query, atau output pengguna.

## 4. Cloudflare Tunnel opsional untuk API

Tunnel hanya diperlukan bila API tetap listen pada loopback VPS dan tidak ada reverse proxy publik terpisah. Simpan credentials dan token di luar repository. Contoh local-managed tunnel berikut hanya memakai placeholder dan tidak boleh dipakai apa adanya:

```yaml
# /etc/cloudflared/config.yml
tunnel: 00000000-0000-0000-0000-000000000000
credentials-file: /etc/cloudflared/00000000-0000-0000-0000-000000000000.json

ingress:
  - hostname: api-staging.example.invalid
    service: http://127.0.0.1:8080
  - service: http_status:404
```

Validasi rule sebelum menjalankan connector:

```bash
cloudflared --config /etc/cloudflared/config.yml tunnel ingress validate
cloudflared --config /etc/cloudflared/config.yml tunnel ingress rule https://api-staging.example.invalid
cloudflared --config /etc/cloudflared/config.yml tunnel run aio-tools-staging
```

Jangan commit credentials JSON atau token tunnel. Bila memakai tunnel token yang dikelola dashboard, injeksikan `TUNNEL_TOKEN` melalui service manager/secret store dan jalankan `cloudflared tunnel --no-autoupdate run --token "$TUNNEL_TOKEN"`; jangan menulis token itu ke `config.yml`, `.env.example`, log, atau command history. Jangan gunakan `noTLSVerify` untuk origin HTTP loopback ini karena Tunnel-to-origin berjalan lokal; public client TLS tetap diterminasi Cloudflare.

Cloudflare Tunnel documentation: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/configuration-file/>.

## 5. CORS, CSP, dan cache verification

`PUBLIC_API_URL` menjadi bagian dari CSP `connect-src` ketika frontend dibangun. `API_ALLOWED_ORIGINS` mengatur CORS API secara exact-origin. Keduanya harus merujuk ke pasangan staging yang sama.

Jalankan preflight dari mesin yang dapat mengakses hostname API:

```bash
curl --include --request OPTIONS https://api-staging.example.invalid/v1/jobs/document.docx-to-pdf \
  --header 'Origin: https://staging.example.invalid' \
  --header 'Access-Control-Request-Method: POST' \
  --header 'Access-Control-Request-Headers: content-type'
```

Verifikasi `204`, `Access-Control-Allow-Origin: https://staging.example.invalid`, `Vary: Origin`, dan `Cache-Control: private, no-store`. Jangan menambahkan wildcard CORS atau melemahkan CSP/cache header untuk "memperbaiki" preflight.

## 6. Smoke test staging

Set shell variable berikut hanya untuk command di bawah. Placeholder harus diganti dengan origin staging yang disetujui, bukan nilai produksi.

```bash
export PUBLIC_APP_URL=https://staging.example.invalid
export PUBLIC_API_URL=https://api-staging.example.invalid
```

### Route dan health checks

```bash
for route in / /image/png-to-jpg /pdf/merge-pdf /video/video-to-gif /document/docx-to-pdf; do
  curl --fail --show-error --silent --output /dev/null "$PUBLIC_APP_URL$route"
done

curl --fail --show-error --silent "$PUBLIC_API_URL/healthz"
```

### DOCX-to-PDF API smoke test

Gunakan DOCX sintetis yang tidak sensitif, misalnya `./staging-smoke.docx`. Command Bash berikut membutuhkan `jq`, membuat job ephemeral, menunggu status `succeeded`, lalu melakukan satu kali download output dan memeriksa signature PDF. Jangan gunakan dokumen pengguna nyata untuk smoke test.

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
    failed|canceled|timed_out) printf 'DOCX job ended with status: %s\\n' "$status" >&2; exit 1 ;;
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

Output hanya dapat diunduh sekali. Bila command gagal atau timeout, lanjutkan ke cleanup/log verification dan investigasi tanpa menyalin isi dokumen ke log atau ticket.

### Browser smoke matrix

Lakukan langkah berikut pada origin staging dengan DevTools Network terbuka:

| Tool         | Langkah dan hasil yang diharapkan                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PNG to JPG   | Upload PNG sintetis, pilih **Process files**, unduh JPG/ZIP, dan pastikan tidak ada request `/v1/jobs`.                                                      |
| Merge PDF    | Upload dua PDF sintetis, ubah urutan, proses, dan pastikan output PDF mengikuti urutan tersebut tanpa request `/v1/jobs`.                                    |
| Video to GIF | Upload video pendek yang tidak sensitif, proses lalu unduh GIF. Pastikan runtime FFmpeg/worker dimuat dari origin frontend dan tidak ada request `/v1/jobs`. |
| DOCX to PDF  | Upload `staging-smoke.docx`, proses, unduh PDF sekali, dan pastikan request API memiliki `Cache-Control: private, no-store`.                                 |

Lakukan juga pemeriksaan visual dan keyboard pada lebar mobile sekitar 390px serta desktop 1440px. Pastikan halaman tidak memiliki horizontal overflow, upload form terlihat, skip link bekerja, dan copy privacy sesuai mode pemrosesan.

### Cleanup dan log verification

Setelah smoke test selesai dan download selesai/cancel, verifikasi job area tmpfs kosong serta log tidak berisi data file pengguna:

```bash
docker compose --env-file .env.staging exec api find /work/jobs -mindepth 1 -maxdepth 1 -print
docker compose --env-file .env.staging exec office-runner find /work/office-jobs -mindepth 1 -maxdepth 1 -print
docker compose --env-file .env.staging logs --since 15m api office-runner
```

Kedua command `find` seharusnya tidak menampilkan artifact job setelah lifecycle selesai. Review log untuk status/health/error agregat saja; jangan salin data file pengguna ke ticket, analytics, atau log eksternal.

## Checklist staging

- [ ] Build frontend menggunakan `PUBLIC_APP_URL` dan `PUBLIC_API_URL` staging yang tepat.
- [ ] Cloudflare Pages melayani `/`, keempat tool route, dan header statis yang ada tanpa perubahan security header.
- [ ] API dan `office-runner` berstatus healthy di Compose; API tetap hanya listen melalui loopback.
- [ ] Tunnel (bila dipakai) tervalidasi, memiliki catch-all `http_status:404`, dan tidak menyimpan token/credentials di repository.
- [ ] CORS preflight mengembalikan origin frontend exact dan API mengembalikan `private, no-store`.
- [ ] DOCX-to-PDF smoke test menghasilkan PDF valid dan output dapat diunduh sekali.
- [ ] PNG-to-JPG, Merge-PDF, dan Video-to-GIF smoke test tidak membuat request `/v1/jobs`.
- [ ] Job tmpfs kosong setelah success, cancel, timeout, atau restart; log tidak memuat data file pengguna.
- [ ] Browser mobile sekitar 390px dan desktop 1440px tidak memiliki horizontal overflow dan upload form tetap dapat digunakan.
- [ ] Staging diberi label preview/demo; tidak ada klaim rilis produksi sebelum provenance FFmpeg WASM selesai.

## Sebelum membuat release

Jalankan quality gates dari root repository:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Staging yang sehat bukan pengganti gate compliance. Jangan membuat release/tag atau klaim production-ready sampai bukti provenance FFmpeg WASM lengkap dan gate compliance tidak lagi diblokir.
