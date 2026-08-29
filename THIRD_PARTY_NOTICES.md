# Third-party notices

The AIO Converter source code is licensed under the GPL-3.0-or-later. Third-party dependencies retain their own licenses.

## Runtime components and compliance

| Component               | Exact Version                                                      | Declared License                                | Use                                             |
| ----------------------- | ------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------- |
| `@ffmpeg/core`          | 0.12.10                                                            | GPL-2.0-or-later (declared in package metadata) | Lazy-loaded WebAssembly engine for Video to GIF |
| `@ffmpeg/ffmpeg`        | 0.12.15                                                            | MIT                                             | Browser worker API for FFmpeg core              |
| FFmpeg WASM object code | Upstream revision not verified; packaged by `@ffmpeg/core` 0.12.10 | GPL applies; raw artifact embeds `--enable-gpl` | Video to GIF runtime                            |
| LibreOffice Writer      | Debian package in `office-worker`                                  | MPL-2.0 / LGPL-3.0-or-later                     | Isolated DOCX to PDF conversion                 |
| `pdf-lib`               | (See lockfile)                                                     | MIT                                             | Used for Merge PDF                              |
| `fflate`                | (See lockfile)                                                     | MIT                                             | Used for PNG to JPG ZIP creation                |

The installed `@ffmpeg/core` metadata declares GPL-2.0-or-later. The raw WASM embeds `--enable-gpl` and no `--enable-nonfree` marker was found, but the npm package contains no source tree or authenticated mapping from its bytes to an exact source/build chain. See `docs/compliance/ffmpeg.md` for the artifact hashes, missing Corresponding Source evidence, and release blocker.

Upstream discovery references:

- https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15
- https://ffmpeg.org/legal.html
- https://www.libreoffice.org/about-us/licenses/

The `ffmpeg.wasm` tag is a candidate source baseline only. Its URL is not, by itself, Corresponding Source evidence for the distributed raw WASM hash.

## Direct JavaScript dependencies

Astro, React, Tailwind CSS, Vitest, Playwright, ESLint, Prettier, and their adapters declare permissive licenses in their package metadata. The exact resolved dependency graph is pinned in `pnpm-lock.yaml`; review it again whenever the lockfile changes.
