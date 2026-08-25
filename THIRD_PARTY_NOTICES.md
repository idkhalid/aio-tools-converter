# Third-party notices

The AIO Converter source itself is **UNLICENSED** until the project owner chooses a license. Dependencies retain their own licenses; the root package metadata does not relicense them.

## Runtime components that need release review

| Component          | Version/build                     | Declared license            | Use                                             |
| ------------------ | --------------------------------- | --------------------------- | ----------------------------------------------- |
| `@ffmpeg/core`     | 0.12.10                           | GPL-2.0-or-later            | Lazy-loaded WebAssembly engine for Video to GIF |
| `@ffmpeg/ffmpeg`   | 0.12.15                           | MIT                         | Browser worker API for FFmpeg core              |
| LibreOffice Writer | Debian package in `office-worker` | MPL-2.0 / LGPL-3.0-or-later | Isolated DOCX to PDF conversion                 |

The prebuilt `@ffmpeg/core` explicitly enables GPL components. Before a public or commercial release, the owner must decide how to meet the GPL source-and-notice obligations or replace it with a reviewed LGPL-only custom FFmpeg build. Do not assume that marking the application `UNLICENSED` resolves those obligations. Obtain legal advice for the intended distribution model.

Upstream source and build configuration:

- <https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15>
- <https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/Dockerfile>
- <https://www.libreoffice.org/about-us/licenses/>

## Direct JavaScript dependencies

`pdf-lib`, `fflate`, Astro, React, Tailwind CSS, Vitest, Playwright, ESLint, Prettier, and their adapters declare permissive licenses in their package metadata. The exact resolved dependency graph is pinned in `pnpm-lock.yaml`; review it again whenever the lockfile changes.

This file is an engineering inventory, not legal advice and not a substitute for including the required license texts and source offers in a distributable release.
