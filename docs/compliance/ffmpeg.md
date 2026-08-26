# FFmpeg Compliance Notes

This document tracks the compliance status and provenance for the FFmpeg WASM binary used by AIO Converter for the Video to GIF tool.

## Current Configuration

- **`@ffmpeg/ffmpeg` Version**: 0.12.15
- **`@ffmpeg/core` Version**: 0.12.10
- **WASM Asset Path Servable to Browser**: `/wasm/ffmpeg/ffmpeg-core.wasm.gz`
- **SHA-256 of `ffmpeg-core.wasm.gz`**: `sha256:1767a2d0c6d6b14de37876261443397cecd591f298b162eded99018de4f6355d`

## Configure Flags

- `--enable-gpl`: **Found**
- `--enable-nonfree`: **Not found**

## Source Status and Provenance

**Status**: blocked pending evidence

The currently distributed FFmpeg WASM binary relies on the pre-built `@ffmpeg/core` package. While it confirms the absence of `--enable-nonfree` and presence of `--enable-gpl`, the exact corresponding source for this specific binary build is not locally verified. This creates a provenance gap preventing verification under the GPL-3.0-or-later license.

## Release Blockers

1. **Provenance gap**: The exact corresponding source tree and build environment for the distributed `@ffmpeg/core` WASM binary is not locally verified.
2. The release remains blocked pending evidence. We must replace the pre-built WASM binary with a locally built, audited version from a verified source to confidently claim GPL compliance.
