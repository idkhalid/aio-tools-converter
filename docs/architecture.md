# Arsitektur Phase 1

AIO Converter memakai satu registry typed dan satu shell halaman untuk semua tool. UI tidak mengimpor library konversi secara langsung; UI hanya berbicara dengan kontrak `JobExecutor` dan menerima `ProcessOutput` yang konsisten.

## Batas modul

| Modul                         | Tanggung jawab                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `packages/tool-core`          | Kontrak tool/processor, validasi file dan option, serta error aman untuk pengguna    |
| `packages/tool-registry`      | Sumber route, metadata, privacy mode, limit, option, dan pemetaan processor          |
| `packages/browser-processors` | Implementasi image, PDF, FFmpeg, worker lifecycle, dan ZIP                           |
| `packages/shared`             | Helper binary, MIME, dan nama output tanpa ketergantungan pada UI                    |
| `apps/web`                    | Astro static routes, React `ToolShell`, aksesibilitas, dan client job API            |
| `apps/api`                    | Upload streaming, lifecycle job sementara, SSE, cancel, one-time output, dan cleanup |
| `office-runner`               | LibreOffice di container terpisah dengan scratch storage sementara                   |

## Jalur local-only

```text
File picker/drop
  -> extension + declared MIME + magic-byte validation
  -> option validation
  -> dedicated Web Worker / worker milik ffmpeg.wasm
  -> Blob output
  -> object URL / ZIP download
  -> revoke URL + terminate worker + cleanup
```

Tidak ada fallback ke API untuk tool `LOCAL_ONLY`. Kegagalan codec, browser yang tidak mendukung, cancel, atau timeout berakhir sebagai error lokal yang aman.

## Jalur server-ephemeral

```text
Browser
  -> POST multipart ke API
  -> job directory acak di tmpfs
  -> Unix socket
  -> office-runner tanpa network
  -> LibreOffice subprocess di process group
  -> PDF kembali ke API
  -> one-time streaming download
  -> hapus input/output dan seluruh job directory
```

API menentukan pemetaan `toolId -> processor`; client tidak pernah dapat memilih binary atau processor. Metadata job hanya berada di RAM. Input dihapus setelah processor selesai, sedangkan output dihapus setelah download pertama, cancel, error, timeout, shutdown, atau TTL paling lama 15 menit. Job antrean juga memiliki deadline absolut; cleanup filesystem yang gagal tetap dilacak dan dicoba ulang oleh sweeper.

## Invariant privasi

- Binary pengguna tidak masuk database, object storage, CDN cache, analytics, atau log.
- Nama file asli hanya dipakai sesaat untuk validasi extension dan tidak disimpan dalam metadata job.
- Response API memakai `Cache-Control: private, no-store`.
- Browser output memakai object URL yang dicabut saat reset/unmount.
- Registry menolak build bila tool `LOCAL_ONLY` menunjuk processor server.
- Service worker tidak digunakan untuk request atau response file pengguna.

## Menambah tool

Untuk varian yang memakai engine yang sudah ada, tambahkan definisi registry dan preset processor. Contohnya, preset image typed menentukan MIME input/output, extension output, dan apakah transparansi diratakan; engine tidak mengunci PNG/JPG di source. Route, metadata, breadcrumb, privacy badge, validasi awal, dan related tools akan mengikuti registry. Processor baru harus tetap mengimplementasikan kontrak bersama dan ditambahkan ke manifest agar validasi build dapat mendeteksi mapping yang hilang.
