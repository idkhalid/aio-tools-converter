# AIO Converter — Update Implementasi

> Snapshot progres: 29 Agustus 2026

Dokumen ini merangkum kondisi implementasi yang benar-benar tersedia di repository saat ini. Isinya bukan daftar ide dari brief lama dan tidak menganggap fitur yang belum diuji sebagai selesai.

## Ringkasan status

| Area                 | Status                    | Catatan                                                                                             |
| -------------------- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| Fondasi monorepo     | Selesai                   | pnpm workspace, TypeScript strict, Astro, React, Go, lint, test, dan build scripts                  |
| UI/UX dasar          | Selesai untuk workspace   | Main Converter Workspace dan seluruh edge state production sudah responsif dan keyboard-accessible  |
| PNG to JPG           | Selesai lintas-browser    | Lulus Chromium/Firefox/WebKit; menggunakan main-thread fallback jika OffscreenCanvas absen          |
| Merge PDF            | Selesai                   | Diproses lokal di browser dengan pengaturan urutan file                                             |
| Video to GIF         | Selesai                   | Diproses lokal dengan FFmpeg WebAssembly yang dimuat saat dibutuhkan                                |
| DOCX to PDF          | Selesai untuk Phase 1     | Compose sehat; matriks lifecycle nyata dan E2E UI-to-LibreOffice sudah lulus                        |
| Dokumentasi GitHub   | Selesai                   | README publik, dokumentasi teknis, third-party notices, dan `.gitignore` sudah dirapikan            |
| Lisensi & Compliance | Diblokir sementara        | GPL-3.0-or-later diadopsi, file lisensi & compliance tersedia; provenance FFmpeg diblokir sementara |
| Repository GitHub    | Terhubung dengan CI aktif | Branch `main` mengikuti `origin/main`; GitHub Actions CI menjalankan quality gates dan E2E          |
| Kesiapan production  | Belum                     | Converter Workspace selesai; release masih menunggu provenance FFmpeg WASM                          |

## Fitur yang telah dibangun

### 1. PNG to JPG

- Mode `LOCAL_ONLY`; file tidak dikirim ke server.
- Mendukung 1–50 file PNG.
- Batas 50 MiB per file dan 200 MiB total.
- Pengaturan kualitas JPG 1–100.
- Warna background dapat dipilih untuk meratakan transparansi PNG.
- Hasil tunggal dapat diunduh langsung; hasil batch dapat dikemas menjadi ZIP.
- Validasi extension, MIME, signature PNG, dan dimensi gambar dilakukan sebelum pemrosesan utama.
- Batas maksimum 40 juta pixel membantu menolak gambar yang berisiko menghabiskan memori.
- Pemrosesan berjalan pada dedicated Web Worker, atau fallback ke main-thread HTMLCanvasElement jika browser tidak mendukung `OffscreenCanvas`.

### 2. Merge PDF

- Mode `LOCAL_ONLY`; seluruh PDF tetap berada di perangkat pengguna.
- Mendukung 2–20 file.
- Batas 50 MiB per file dan 250 MiB total.
- File dapat diurutkan ulang sebelum digabungkan.
- Urutan halaman hasil mengikuti urutan file pada queue.
- Processor membatasi jumlah halaman total hingga 1.000 halaman.
- PDF rusak atau encrypted ditolak dengan pesan error aman; tidak ada repair tersembunyi.
- Pemrosesan berjalan pada dedicated Web Worker menggunakan `pdf-lib`.

### 3. Video to GIF

- Mode `LOCAL_ONLY` untuk MP4, WebM, dan MOV.
- Satu file dengan ukuran maksimal 150 MiB.
- Clip dapat dipilih dari 1–30 detik.
- Pengaturan FPS 5–20 dan lebar output 160–960 pixel.
- FFmpeg WebAssembly dimuat secara lazy hanya ketika tool digunakan.
- Runtime WASM disimpan sebagai asset gzip sekitar 10 MiB; raw WASM sekitar 32 MiB tidak masuk output deployment.
- Mendukung progress, cancel, retry, cleanup worker, dan pencabutan object URL.
- Asset FFmpeg hasil `predev`/`prebuild` diabaikan oleh Git karena dapat dibuat ulang dari dependency.

### 4. DOCX to PDF

- Mode `SERVER_EPHEMERAL` karena LibreOffice tidak berjalan langsung di browser.
- Satu file DOCX dengan ukuran maksimal 50 MiB.
- Browser membuat job ke API Go melalui multipart upload.
- DOCX divalidasi sebagai OOXML ZIP, termasuk signature, struktur entry, traversal, duplikasi, encryption, macro-enabled content, compression ratio, dan expanded size.
- Progress/status dikirim melalui Server-Sent Events.
- Output PDF hanya dapat diunduh satu kali.
- Output diperiksa kembali melalui signature PDF dan EOF marker sebelum tersedia untuk download.
- Job dapat dibatalkan dan memiliki timeout serta TTL maksimal 15 menit secara default.
- Input dihapus setelah processor selesai; output dibersihkan setelah download, cancel, error, timeout, shutdown, atau TTL.
- Fidelity mengikuti font dan kemampuan LibreOffice di container sehingga tidak dijamin identik dengan Microsoft Word.

## Fondasi aplikasi web

- Astro 7 menghasilkan halaman statis untuk homepage, 404, sitemap, robots, dan setiap route tool.
- React 19 digunakan untuk generic `ToolShell` interaktif.
- Tailwind CSS 4 digunakan untuk baseline visual.
- Empat route aktif:
  - `/image/png-to-jpg`
  - `/pdf/merge-pdf`
  - `/video/video-to-gif`
  - `/document/docx-to-pdf`
- Satu typed tool registry menjadi sumber metadata, route, limit, opsi, privacy mode, SEO, dan pemetaan processor.
- Generic shell menyediakan drop zone, file queue, reorder, opsi, progress, cancel, retry, error state, dan result download.
- Related tools, breadcrumb, title, description, canonical URL, dan structured metadata mengikuti registry.
- Nama aplikasi dapat diganti melalui `PUBLIC_APP_NAME`.
- UI saat ini mobile-first, memiliki skip link, focus state, label form, status announcement, dan navigasi keyboard dasar.
- Struktur UI tetap dipisahkan dari processor sehingga edge state dan perubahan presentation dapat diterapkan tanpa menulis ulang engine konversi.

## Converter Workspace edge states

Implementasi edge-state production untuk Converter Workspace selesai pada 29 Agustus 2026. Perubahan tetap menggunakan visual baseline tool-shell yang sudah ada dan tidak mendesain ulang happy path.

- **Unsupported File Type** menampilkan status `Unsupported file type`/`Unsupported format` dengan aksi menghapus atau mengganti file.
- **File Too Large** menampilkan ukuran yang dipilih dan limit yang berlaku, termasuk aksi menghapus atau mengunggah file lebih kecil.
- **Partial Success Batch** mempertahankan semua output yang berhasil, menyediakan bulk download untuk hasil sukses, dan aksi retry per file gagal.
- **Cancelled State** mempertahankan file yang dipilih serta menyediakan `Start again` dan `Remove files`.
- **Browser Not Supported** menyediakan arahan browser modern, pemilihan file lain, dan navigasi kembali ke katalog tool.
- **Backend Unavailable** menggunakan pesan aman untuk tool server sementara, dengan aksi retry dan pemilihan file lain.
- **Empty Result** menangani proses yang selesai tanpa output unduhan dengan aksi retry atau upload ulang.
- **Mobile Sticky Action Bar** aktif hanya pada viewport mobile ketika file siap diproses atau hasil siap diunduh, memakai safe-area padding dan tambahan ruang bawah agar konten tidak tertutup.

State machine tool-shell sekarang membedakan fase `canceled`, `partial-success`, dan `empty`. Perubahan hanya menyentuh presentation/state orchestration di `packages/ui/src/tool-shell`; processor browser, backend/API, worker, route, CI, compliance, package manifest, dan lockfile tidak diubah.

Kontrak regresi berikut tetap dipertahankan:

- Tombol proses tetap dapat diakses sebagai `getByRole("button", { name: "Process files" })`.
- Elemen `#file-queue-heading + span` tetap menghasilkan `2 selected` untuk dua file.
- PNG single download dan bulk ZIP tetap tersedia.
- Reorder Merge PDF, flow DOCX to PDF, flow Video to GIF, dan output filename yang sudah ada tetap dipertahankan.

## Arsitektur pemrosesan

### Jalur lokal

```text
File picker/drop
  -> validasi extension, MIME, magic bytes, size, dan options
  -> dedicated Web Worker / worker ffmpeg.wasm
  -> Blob output atau ZIP
  -> object URL download
  -> revoke URL dan terminate worker
```

Tidak ada fallback diam-diam dari tool `LOCAL_ONLY` ke server.

### Jalur server sementara

```text
Browser
  -> Go job API
  -> random job directory di tmpfs
  -> Unix socket
  -> LibreOffice runner tanpa network
  -> one-time PDF download
  -> cleanup seluruh job directory
```

API menentukan pemetaan `toolId` ke processor. Client tidak dapat memilih executable atau command server.

## Backend dan isolasi office

- API dan office runner ditulis dengan Go 1.24.
- Upload diproses secara streaming dan dibatasi ukurannya.
- Metadata job hanya disimpan di RAM.
- Job ID dibuat acak dan output menggunakan download satu kali.
- Lifecycle mendukung antrean, progress, success, failure, cancel, timeout, TTL, dan shutdown cleanup.
- Queue memiliki batas jumlah job dan deadline absolut.
- Cleanup yang gagal dicatat dan dicoba kembali oleh sweeper.
- API menyediakan health endpoint dan metrics agregat tanpa filename atau isi file pengguna.
- Komunikasi API ke office runner menggunakan Unix domain socket dengan token opsional.
- Container office runner:
  - berjalan sebagai non-root;
  - menggunakan filesystem read-only;
  - memakai tmpfs untuk scratch storage;
  - memakai `network_mode: none`;
  - menghapus seluruh Linux capabilities;
  - mengaktifkan `no-new-privileges`;
  - memiliki batas CPU, RAM, PID, dan waktu proses;
  - tidak memublikasikan port.
- Default hanya menjalankan satu job LibreOffice pada satu waktu per runner.

## Keamanan dan privasi

- Browser tool dan server tool memiliki privacy badge yang berbeda.
- Binary dari tool lokal tidak masuk request `/v1/jobs`.
- File server tidak disimpan ke database, object storage, CDN cache, atau persistent volume.
- Nama file asli hanya dipakai sesaat untuk validasi dan tidak disimpan sebagai metadata job.
- Response API menggunakan `Cache-Control: private, no-store`.
- CORS hanya menerima origin frontend yang dikonfigurasi; wildcard ditolak.
- Error internal dipetakan menjadi pesan aman untuk pengguna.
- CSP dibuat pada build time dan memasukkan origin API yang dikonfigurasi.
- Header frontend mencakup baseline security headers serta COOP/COEP/CORP untuk kebutuhan worker dan WebAssembly.
- Service worker tidak digunakan untuk request maupun response file pengguna.
- Tidak ditemukan credential yang terbuka pada audit source sederhana; hanya template `.env.example` yang disimpan.

## Struktur repository

```text
apps/
  web/                 Astro frontend, React island, workers, dan E2E
  api/                 Go API, office runner, Dockerfile, dan integration test
packages/
  tool-core/           Kontrak tool, options, file validation, dan safe errors
  tool-registry/       Definisi tool, preset, manifest, dan registry validation
  browser-processors/  Image, PDF, FFmpeg, worker lifecycle, dan ZIP
  server-contracts/    Job API client, types, dan SSE parser
  ui/                  Generic ToolShell dan state machine
  shared/              Helper binary, MIME, bytes, dan filename
docs/
  architecture.md
  development.md
  deployment.md
```

## Developer experience dan dokumentasi

- Root scripts tersedia untuk dev, lint, typecheck, test, build, E2E, preview, format, dan compliance.
- Dependency JavaScript dikunci dengan `pnpm-lock.yaml`.
- `.env.example` mendokumentasikan URL, origin, limit, timeout, socket, dan concurrency.
- File `LICENSE` ditambahkan untuk GNU GPLv3.
- `TRADEMARKS.md` dibuat untuk melindungi identitas visual proyek.
- `THIRD_PARTY_NOTICES.md` diperbarui dengan versi persis dari `pnpm-lock.yaml`.
- `docs/compliance/ffmpeg.md` dibuat untuk mendokumentasikan status provenance WASM.
- `scripts/compliance.mjs` dibuat dan `pnpm compliance` tersedia sebagai pengawal build.
- `README.md` sudah diubah dari implementation contract menjadi halaman proyek GitHub.
- `.gitignore` sekarang mengecualikan dependency, env lokal, cache, build output, test report, generated FFmpeg assets, Go binary, log, dan file editor/OS.
- Dokumentasi terpisah tersedia untuk arsitektur, development, deployment, compatibility, dan third-party licenses.
- Repository Git sudah memakai branch `main` dan terhubung ke remote GitHub `origin`.
- GitHub Actions CI sudah ditambahkan; menjalankan format, lint, typecheck, test, build, E2E (Playwright 3 browser), dan audit lisensi secara terpisah.

## Hasil verifikasi terakhir

| Gate                           | Hasil terakhir                                                  |
| ------------------------------ | --------------------------------------------------------------- |
| `pnpm format` / `format:check` | Lulus                                                           |
| `pnpm lint`                    | Lulus                                                           |
| `go -C apps/api vet ./...`     | Lulus                                                           |
| `pnpm typecheck`               | Lulus, 0 error                                                  |
| `pnpm test`                    | Lulus                                                           |
| `go -C apps/api test ./...`    | Lulus                                                           |
| `pnpm build`                   | Lulus                                                           |
| Tool-shell reducer             | 8 test lulus                                                    |
| Workspace regression E2E       | 36 lulus, 4 dilewati sesuai flag heavy-media                    |
| `pnpm compliance`              | Sengaja digagalkan (blocked pending evidence provenance FFmpeg) |
| Release Compliance Audit       | Blocker dikenal menjadi warning; error lain tetap hard-fail     |
| Playwright + API Compose       | 41 lulus, 3 dilewati secara sengaja (total 44 test)             |
| Matriks lifecycle container    | Success, cancel, timeout, disconnect, restart lulus             |

Playwright penuh telah memeriksa route desktop/mobile, flow tool lokal, fallback HTMLCanvasElement, pemrosesan FFmpeg aktual, dan DOCX melalui API Compose di 3 browser (Chromium, Firefox, WebKit). Hasil akhirnya 41 test lulus dan 3 test dilewati secara sengaja (smoke FFmpeg hanya di Chromium desktop).

Regresi terbaru untuk Converter Workspace dijalankan pada Chromium, Firefox, WebKit, dan mobile Chromium menggunakan `PLAYWRIGHT_SKIP_API_SERVER=1` serta `PLAYWRIGHT_SKIP_HEAVY_MEDIA=1`. Sebanyak 36 test lulus dan 4 test Video to GIF dilewati sesuai flag. Suite dijalankan dari workspace root agar konfigurasi `playwright.config.ts` di root digunakan. PNG batch ZIP, individual download, fallback canvas, Merge PDF reorder, route, metadata, responsive layout, dan kontrak mobile tetap lulus.

Classifier Release Compliance Audit diperketat pada 29 Agustus 2026. CI sekarang hanya menerima satu baris blocker provenance FFmpeg yang persis dikenal sebagai warning; setiap `[COMPLIANCE ERROR]` lain tetap menggagalkan job. Regresi classifier memastikan output saat ini masuk jalur blocker yang dikenal, sedangkan simulasi `--enable-nonfree` tetap masuk jalur real failure.

## Audit lintas-browser 26 Agustus 2026

Audit browser-only tambahan dijalankan terhadap build terbaru menggunakan Playwright 1.62.1 dengan Firefox 153.0 dan WebKit 26.5 di Windows. Audit ini melengkapi E2E Chromium yang sudah ada, tetapi tidak menggantikan validasi akhir pada Firefox branded dan Safari asli di macOS/iOS.

### Cakupan yang diuji

- Lima route (`/`, PNG to JPG, Merge PDF, Video to GIF, dan DOCX to PDF) diperiksa pada viewport desktop 1280 x 720 dan viewport sempit 390 x 844.
- Layout responsif, horizontal overflow, katalog, metadata, canonical URL, privacy badge, hydration React, dan tampilan form diperiksa di Firefox dan WebKit.
- Navigasi keyboard dan perilaku skip link diuji sampai aktivasi `#main-content`.
- PNG to JPG diuji dengan dua PNG sintetis, transparency background, quality, dua download JPG, dan ZIP valid.
- Merge PDF diuji dengan dua PDF sintetis, reorder, urutan tiga halaman hasil, dan download PDF valid.
- Video to GIF diuji dengan WebM statis, opsi durasi/FPS/lebar, hasil GIF valid, dan download.
- UI DOCX to PDF berhasil dimuat pada kedua engine. Konversi DOCX lintas-browser tidak dijalankan pada sesi ini karena Docker/API tidak aktif.
- Dua puluh screenshot baseline dibuat untuk lima route pada dua viewport dan dua engine. Tidak ditemukan overflow atau kerusakan layout pada state awal.

### Hasil per browser

| Alur                        | Firefox 153.0                                         | WebKit 26.5 di Windows                                                                         |
| --------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Route, metadata, dan layout | Lulus                                                 | Lulus                                                                                          |
| Skip link                   | Lulus dengan `Tab` dan `Enter`                        | Aktivasi dan target lulus; urutan `Tab` mengikuti preferensi `tabsToLinks` WebKit/Safari       |
| PNG to JPG dan ZIP          | Lulus                                                 | Lulus menggunakan fallback HTMLCanvasElement di main-thread (`OffscreenCanvas` tidak tersedia) |
| Merge PDF dan download      | Lulus                                                 | Lulus                                                                                          |
| Video to GIF                | Lulus setelah intersepsi IDM pada asset WASM dilewati | Lulus dengan fixture WebM statis                                                               |
| DOCX to PDF                 | UI lulus; konversi tidak dijalankan                   | UI lulus; konversi tidak dijalankan                                                            |

### Diagnosis dan perbaikan metode verifikasi

- Fixture E2E Video to GIF yang membuat WebM melalui `MediaRecorder` tidak kompatibel dengan WebKit/Firefox. Test diskip secara gracefully untuk browser non-Chromium pada fixture sintetis.
- Fallback WebKit menggunakan main-thread canvas telah lulus uji fungsional: dapat menangani banyak file, mempertahankan transaparansi dan konversi ZIP tanpa mengirim data ke server.
- Playwright E2E telah diperluas untuk menjalankan Firefox dan WebKit pada setiap commit CI.

### Perbaikan production yang masih diperlukan

- Tolak respons FFmpeg 204/zero-byte dengan pesan yang tepat dan pertimbangkan nama asset terkompresi berekstensi netral agar tidak diintersepsi download manager.

## Hasil validasi P0 backend nyata

- Success menghasilkan PDF valid 15.142 byte; setelah one-time download, kedua root job kosong.
- Cancel dilakukan saat status job benar-benar `running`; DELETE merespons 204 dan kedua root job kosong.
- Timeout dipicu dari office runner nyata dengan batas 1 ms; API melaporkan `timed_out` dengan kode `process_timeout`, lalu konfigurasi default dipulihkan.
- Disconnect diuji pada output PDF 1.400.949 byte; client diputus setelah menerima 3.756 byte dan cleanup tetap menyelesaikan kedua root job.
- Restart API dilakukan ketika job masih `running`; setelah health pulih, ID lama merespons 404 dan kedua root job kosong.
- `/work/jobs` dan `/work/office-jobs` diverifikasi kembali kosong setelah setiap skenario. Socket `/run/aio-office/office.sock` tetap tersedia sebagaimana mestinya.
- Full Playwright suite dengan API container aktif selesai dalam 24 detik: 18 lulus dan 2 skip yang disengaja.

Validasi ini juga menemukan dan memperbaiki race hydration pada upload E2E, kompatibilitas gzip FFmpeg pada Vite development server, import core FFmpeg dari public directory, serta flake assertion TTL yang mendahului cleanup asynchronous.

## Status runtime saat snapshot

- Frontend development berjalan di <http://localhost:4321>.
- Homepage, route DOCX to PDF, dan API `/healthz` merespons HTTP 200.
- Docker Desktop 29.7.2 sudah terpasang pada instalasi per-user.
- WSL dan Docker Linux engine sudah aktif; server Docker melaporkan versi 29.7.2.
- Image `api` dan `office-runner` berhasil dibangun melalui Compose.
- Container API dan office runner berjalan dengan status `healthy`.
- DOCX sintetis berhasil dikonversi end-to-end menjadi PDF valid melalui ketiga endpoint job (`POST`, SSE, dan output).

## Yang belum selesai

1. Review visual final untuk area aplikasi di luar Converter Workspace.
2. Provenance/source tree dari `@ffmpeg/core` belum terselesaikan (blocked pending evidence).

## Prioritas berikutnya

### P0 — Validasi backend nyata (selesai)

- Matriks success, cancel, timeout, download disconnect, restart, dan cleanup sudah lulus pada Compose nyata.
- Kedua direktori job kembali kosong setelah setiap skenario gagal maupun berhasil.
- Seluruh Playwright suite sudah lulus dengan API container aktif: 18 lulus, 2 skip disengaja.

### P0 — Release compliance

- Adopsi lisensi: **selesai** (GPL-3.0-or-later).
- Compliance guardrail: **selesai** (`pnpm compliance`).
- Exact corresponding source/provenance FFmpeg: **blocked pending evidence**.
- Tindakan berikutnya: kompilasi WASM FFmpeg secara lokal dari source tree terverifikasi, atau ganti dengan custom build LGPL-only yang telah direview.

### P1 — Design pass Converter Workspace (selesai)

- Main Converter Workspace tetap menjadi visual baseline; happy path tidak didesain ulang pada edge-state pass.
- Unsupported, oversized, partial success, cancelled, browser unsupported, backend unavailable, empty result, dan mobile sticky action bar sudah diterapkan.
- Kontrak `ToolShell`, processor, nama file output, mobile layout, keyboard, focus, dan announcement tetap dipertahankan.

### P1 — Release confidence (selesai)

- CI GitHub otomatis mengeksekusi format, lint, typecheck, build, dan browser-only E2E (Chromium/Firefox/WebKit).
- Fallback PNG WebKit diimplementasikan dan fully tested E2E lintas browser.

## Release compliance status

- **Source license**: GPL-3.0-or-later
- **Trademark/brand assets**: Reserved (dilindungi melalui TRADEMARKS.md)
- **Third-party notices**: Updated (menggunakan versi resolusi presisi dari lockfile)
- **FFmpeg configure status**: `--enable-gpl` found, `--enable-nonfree` not found
- **FFmpeg provenance**: Blocked pending evidence
- **Public repo**: OK (Source dapat dipublikasikan)
- **Production/tagged release**: Blocked (Dibutuhkan bukti provenance FFmpeg WASM sebelum distribusi publik berjalan penuh)

## Perintah penting

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

Dokumentasi lanjutan:

- [README](README.md)
- [Arsitektur](docs/architecture.md)
- [Development](docs/development.md)
- [Deployment](docs/deployment.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
