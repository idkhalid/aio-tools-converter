# Third-party notices

The AIO Converter source code is licensed under the GPL-3.0-or-later. Third-party dependencies retain their own licenses.

## Runtime components and compliance

| Component          | Exact Version                     | Declared License            | Use                                             |
| ------------------ | --------------------------------- | --------------------------- | ----------------------------------------------- |
| `@ffmpeg/core`     | 0.12.10                           | GPL-2.0-or-later            | Lazy-loaded WebAssembly engine for Video to GIF |
| `@ffmpeg/ffmpeg`   | 0.12.15                           | MIT                         | Browser worker API for FFmpeg core              |
| FFmpeg Runtime     | 0.12.10                           | GPL-2.0-or-later            | Built with `--enable-gpl`                       |
| LibreOffice Writer | Debian package in `office-worker` | MPL-2.0 / LGPL-3.0-or-later | Isolated DOCX to PDF conversion                 |
| `pdf-lib`          | (See lockfile)                    | MIT                         | Used for Merge PDF                              |
| `fflate`           | (See lockfile)                    | MIT                         | Used for PNG to JPG ZIP creation                |

The prebuilt `@ffmpeg/core` explicitly enables GPL components. See `docs/compliance/ffmpeg.md` for specific configuration details and provenance validation blocking the current release.

Upstream source and build configuration:

- https://github.com/ffmpegwasm/ffmpeg.wasm
- https://www.libreoffice.org/about-us/licenses/

## Direct JavaScript dependencies

Astro, React, Tailwind CSS, Vitest, Playwright, ESLint, Prettier, and their adapters declare permissive licenses in their package metadata. The exact resolved dependency graph is pinned in `pnpm-lock.yaml`; review it again whenever the lockfile changes.
