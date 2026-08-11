# QA Baselines

## Current Release

- Public version: `v1.2.0`
- Android `versionCode`: `15`
- Package: `com.blockcolc.app`
- Formal signer SHA-256: `6405e2ff95a32549699a3081372e8462317bee717c08caabf67678f211ddc6e3`
- Release APK SHA-256: `e48f54e79fe81ae87f714e01a5acc46d2082ce1c975763e361140dfd9054b87c`
- Product baseline at release: full low-concurrency Playwright `100` passed with `4` planned project skips; unit/type/build/Capacitor/Android JVM/Lint passed.
- Optimized workflow baseline: `395` unit tests; `2` browser persistence/core-loop tests; Web release matrix `58/58` with no planned project skips; production build, Capacitor sync, Android JVM tests, Release Lint, formal signing, and APK metadata checks pass.
- Measured development-machine times: checkpoint gate `69.3s`, optimized Web matrix `256.8s`, prechecked Android build chain `64.9s`. Treat these as comparison baselines, not hard timeouts.

## Reference Device

- OnePlus PJX110, Android 16 / API 36, device id is recorded only in local execution evidence.
- Preserve app data during candidate installation. Do not use `pm clear` for release coverage.
- Subjective 3D rotation smoothness remains a manual acceptance item even when automated frame and package checks pass.

## Required Viewports

`360x800`, `412x915`, `915x412`, `768x1024`, `1440x900`.

The mobile project owns complete product flows. Desktop runs the multi-viewport, pointer, and environment-interaction subset; renderer and lighting regressions run on both projects.

## Evidence Rules

Store generated evidence under ignored `artifacts/`. Keep the current baseline here concise; put run-specific logs, screenshots, traces, and device dumps in the corresponding artifact directory. Every copied or downloaded artifact needs a SHA-256 comparison.
