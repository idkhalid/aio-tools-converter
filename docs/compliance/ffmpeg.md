# FFmpeg WASM Provenance and Release Gate

This document is the repository-local engineering record for the FFmpeg WebAssembly object code used by the Video to GIF tool. It is not legal advice.

**Provenance status**: `blocked pending evidence`

**Release decision**: do not publish a production or tagged release containing the current FFmpeg WASM until Path A or Path B below satisfies every acceptance check.

## Current artifact chain

The application does not build FFmpeg from source. The current chain is:

1. `pnpm-lock.yaml` resolves `@ffmpeg/core` to `0.12.10`.
2. `apps/web/scripts/copy-ffmpeg-assets.mjs` resolves the package's ESM entry and reads the adjacent `dist/esm/ffmpeg-core.wasm`.
3. The script gzip-compresses those bytes into the ignored/generated path `apps/web/public/wasm/ffmpeg/ffmpeg-core.wasm.gz`.
4. Astro copies the gzip asset into the static build. The JavaScript glue is bundled separately by Vite.

Copying or compressing the dependency artifact is not an FFmpeg source build and does not establish provenance.

| Item                      | Current identity                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `@ffmpeg/ffmpeg`          | `0.12.15`                                                                                                            |
| `@ffmpeg/core`            | `0.12.10`, package metadata declares `GPL-2.0-or-later`                                                              |
| npm tarball               | `https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz`                                                         |
| npm integrity in lockfile | `sha512-dzNplnn2Nxle2c2i2rrDhqcB19q9cglCkWnoMTDN9Q9l3PvdjZWd1HfSPjCNWc/p8Q3CT+Es9fWOR0UhAeYQZA==`                    |
| npm dist shasum           | `3177e88852bfbfaad5d258e9e0ac1fd9dffd3223`                                                                           |
| Raw ESM/UMD WASM          | 32,232,419 bytes; SHA-256 `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7`                         |
| Generated gzip            | 10,257,774 bytes in the audited checkout; SHA-256 `1767a2d0c6d6b14de37876261443397cecd591f298b162eded99018de4f6355d` |
| Browser URL               | `/wasm/ffmpeg/ffmpeg-core.wasm.gz`                                                                                   |

The decompressed generated asset is byte-for-byte identical to both installed ESM and UMD WASM files. The raw WASM hash is the guardrail's authoritative artifact identity; a gzip hash difference is only a warning because the compressed representation is not the licensed object-code identity.

The installed npm package contains only `package.json` and ESM/UMD JavaScript/WASM output. It contains no source tree, build scripts, build log, `config.log`, README, license text, or source manifest. The registry metadata available during this audit has no `gitHead` field. The npm integrity therefore identifies the downloaded package, but does not identify the source and build that produced its WASM.

## Artifact observations, not provenance proof

The raw WASM embeds this configure line:

```text
--target-os=none --arch=x86_32 --enable-cross-compile --disable-asm --disable-stripping --disable-programs --disable-doc --disable-debug --disable-runtime-cpudetect --disable-autodetect --nm=emnm --ar=emar --ranlib=emranlib --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc --extra-cflags='-I/opt/include -O3 -msimd128' --extra-cxxflags='-I/opt/include -O3 -msimd128' --disable-pthreads --disable-w32threads --disable-os2threads --enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx --enable-libmp3lame --enable-libtheora --enable-libvorbis --enable-libopus --enable-zlib --enable-libwebp --enable-libfreetype --enable-libfribidi --enable-libass --enable-libzimg
```

The artifact also contains strings for FFmpeg `5.1.4`, libavcodec `59.37.100`, and Emscripten `3.1.40`. `--enable-gpl` is present and `--enable-nonfree` is absent. These observations explain the package's GPL declaration and rule out an obvious nonfree configure marker; they do not prove which source revisions, patches, libraries, or environment produced the bytes.

The strongest upstream lead is [`ffmpeg.wasm` tag `v12.15`](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15), commit `71aa99d37c02a7b4c435275ca9ef50e612f6efa1`. At that tag, `packages/core/package.json` is version `0.12.10`, while the Dockerfile names Emscripten `3.1.40`, FFmpeg `n5.1.4`, and the same major GPL libraries observed in the binary. This is a plausible source baseline, not an authenticated mapping from the npm tarball or raw WASM to that commit. Several Dockerfile inputs are also mutable names such as the x264 `4-cores` branch and LAME `master`.

## Exact evidence still missing

A release review needs all of the following:

1. An authenticated mapping from the shipped raw WASM hash to the exact `ffmpeg.wasm` source commit used to build it.
2. The exact FFmpeg commit and complete adapter/binding/fftools sources, including every local patch.
3. Immutable full commit IDs or archive checksums for every statically linked library, plus its license text and review result.
4. The exact Emscripten commit, compiler/linker versions, base container digest, operating-system packages, and other build-tool versions.
5. The complete build commands, Dockerfile/scripts, build arguments, environment, configure output, `config.log`, and build log.
6. An artifact manifest connecting all source/toolchain inputs to the raw and compressed WASM hashes. A reproducible hash match is strong verification, although the required source is the source actually used and its build/install scripts.
7. A complete Corresponding Source bundle, its SHA-256, a durable release URL beside the distributed object code, and any relinking materials required by the selected license path.

An upstream repository URL, package version, lockfile integrity, embedded version string, or matching configure flags alone does not close these gaps.

## Current guardrail behavior

Generate the audit input and run the guardrail from the repository root:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @aio-converter/web run prebuild
corepack pnpm view @ffmpeg/core@0.12.10 version license repository gitHead dist --json
corepack pnpm compliance
```

`pnpm compliance` must:

- hard-fail when the generated gzip asset is missing or cannot be decompressed;
- hard-fail when the decompressed raw WASM hash differs from the pinned hash;
- inspect the raw WASM and hard-fail if `--enable-nonfree` is present;
- report the embedded `--enable-gpl` marker for audit context;
- hard-fail while the single, anchored provenance status above remains `blocked pending evidence`.

The expected result today is a non-zero exit caused only by the known provenance blocker. Asset, hash, decompression, license-field, or nonfree failures are separate defects and are not acceptable expected failures.

## Path A: verified local GPL build (recommended)

Path A best preserves current codec behavior and aligns with this repository's `GPL-3.0-or-later` license.

In the next implementation pass:

1. Add a small repository-local build recipe under `scripts/ffmpeg/` and a machine-readable source lock/attestation under `docs/compliance/`. Do not vendor the source trees.
2. Start review from candidate commit `71aa99d37c02a7b4c435275ca9ef50e612f6efa1`, but replace every branch/tag/remote `ADD` and the Emscripten image tag with reviewed full commits, archive hashes, and an image digest.
3. Build a new replacement artifact from local, locked source contexts. Do not claim that a rebuild retrospectively proves the origin of the current npm binary.
4. Capture source locks, licenses, patches, build metadata/logs, configure output, raw/gzip hashes, and a complete source archive.
5. Run Video to GIF fixtures for MP4, WebM, and MOV plus all repository gates before replacing or promoting the runtime.

Source discovery commands for the next pass:

```bash
set -euo pipefail
FFMPEG_AUDIT_WORK="$(mktemp -d)"
FFMPEG_WASM_COMMIT="71aa99d37c02a7b4c435275ca9ef50e612f6efa1"

git clone https://github.com/ffmpegwasm/ffmpeg.wasm.git "$FFMPEG_AUDIT_WORK/ffmpeg.wasm"
git -C "$FFMPEG_AUDIT_WORK/ffmpeg.wasm" checkout --detach "$FFMPEG_WASM_COMMIT"
test "$(git -C "$FFMPEG_AUDIT_WORK/ffmpeg.wasm" rev-parse HEAD)" = "$FFMPEG_WASM_COMMIT"
git -C "$FFMPEG_AUDIT_WORK/ffmpeg.wasm" submodule update --init --recursive
git -C "$FFMPEG_AUDIT_WORK/ffmpeg.wasm" submodule status --recursive
git -C "$FFMPEG_AUDIT_WORK/ffmpeg.wasm" diff --binary > ffmpeg-source-changes.diff
```

Resolve every dependency reference with `git ls-remote`, review it, and record the resulting 40-character commit in the future source lock. Do not build from `main`, `master`, a mutable branch, or an unresolved tag.

Once the locked Dockerfile and local source contexts exist, the build/recording interface should be:

```bash
docker buildx build \
  --no-cache \
  --pull=false \
  --provenance=mode=max \
  --metadata-file artifacts/ffmpeg/buildx-metadata.json \
  --output type=local,dest=artifacts/ffmpeg/core \
  -f scripts/ffmpeg/Dockerfile.locked \
  scripts/ffmpeg

sha256sum artifacts/ffmpeg/core/dist/esm/ffmpeg-core.wasm \
  > artifacts/ffmpeg/SHA256SUMS
gzip -n -9 -c artifacts/ffmpeg/core/dist/esm/ffmpeg-core.wasm \
  > artifacts/ffmpeg/ffmpeg-core.wasm.gz
sha256sum artifacts/ffmpeg/ffmpeg-core.wasm.gz \
  >> artifacts/ffmpeg/SHA256SUMS
```

The next pass should encapsulate source resolution, build, verification, and source packaging as `scripts/ffmpeg/resolve-sources.mjs`, `scripts/ffmpeg/build.sh`, `scripts/ffmpeg/verify.mjs`, and `scripts/ffmpeg/package-source.sh`. Those scripts must consume the source lock rather than downloading mutable references during the build.

## Path B: reviewed custom LGPL-only build

Path B reduces the GPL codec surface but has greater compatibility and relinking-review risk for a monolithic WebAssembly build. FFmpeg's own [license checklist](https://ffmpeg.org/legal.html) requires an LGPL build to omit both `--enable-gpl` and `--enable-nonfree`, distribute exact source/build instructions, and review every linked external library.

Use the same locked source/toolchain/attestation pipeline as Path A, but create a minimal profile for the current MP4/WebM/MOV-to-GIF command:

```text
--disable-gpl
--disable-nonfree
--disable-postproc
--disable-autodetect
--disable-network
```

Remove the x264/x265 build stages, `--enable-libx264`, `--enable-libx265`, their link flags, and all other external libraries that are not explicitly required and license-reviewed. Prefer FFmpeg's native LGPL-compatible decoders, demuxers, GIF encoder, `fps` filter, and `scale` filter. Do not assume that removing external codecs preserves support: test representative H.264/HEVC MP4/MOV and VP8/VP9 WebM fixtures before promotion.

Acceptance additionally requires:

- the embedded configure line contains neither `--enable-gpl` nor `--enable-nonfree`;
- `ffmpeg -L` and the complete linked-component inventory are reviewed as LGPL-compatible;
- `libpostproc`, libx264, libx265, and any other GPL component are absent;
- the Corresponding Source bundle, build scripts, license texts, notices, and any materials needed to relink the monolithic WASM are published after legal review.

## Release acceptance checklist

Do not change the provenance status to `provenance verified` until one reviewed path has all of these:

- immutable source lock with full commits/checksums for every input;
- pinned container/toolchain identity and complete build record;
- raw WASM and gzip hashes generated from that build;
- binary configure/nonfree scan and codec/license inventory;
- functional Video to GIF and full repository test results;
- complete Corresponding Source/relink bundle with SHA-256 and durable release URL;
- updated notices and a reviewer/date record tying the released asset to the evidence.

Only update the expected raw hash in `scripts/compliance.mjs` in the same reviewed change that introduces the newly built artifact path and its provenance evidence. The current npm-derived binary remains blocked regardless of its stable hash.
