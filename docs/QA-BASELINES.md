# QA Baselines

## V17 / v1.3.1 release scope (2026-08-14)

- Release scope includes unfinished-focus continuity, compact building memory, effective-focus statistics and rhythm durations, multi-project task organization, notification-capability visibility, and bounded Android 16x resource-pack chunk transport.
- The formal APK, installed-device copy, GitHub upload, redownload, and final device copy are compared through the machine-readable release evidence under the ignored `artifacts/release/v1.3.1` directory.

## V16 / v1.3.0 release scope (2026-08-11)

- Release scope includes terrain generation v4, hydrology and mountain tuning, distant texture minification, bounded Cinematic multisampling, total-plan timer presentation, page-tail spacing, night glow/water regressions, and full-terrain camera clipping at maximum zoom.
- The maximum-zoom regression runs on Pixel 7 and desktop Chromium across four orbit directions. Diagnostics require the near plane to stay within `72%` of the nearest full-terrain bound and the far plane to retain at least `24` world units beyond its farthest point, with request-on-demand rendering unchanged.
- The formal APK, installed-device copy, GitHub upload, redownload, and final device copy are compared through the machine-readable release evidence under the ignored `artifacts/release/v1.3.0` directory.
- The formal Web release matrix uses one Playwright worker. Renderer-heavy screenshot and gesture cases share the host GPU, so parallel workers can create concurrency-only timeouts even when each viewport passes independently.
- `v15-lighting-quality` rebuilds the WebGL renderer once per outline/quality change (five full rebuilds per viewport); its main case uses a 60s budget like the other renderer-heavy cases. `v10-habit-flow`'s ten-round cycle plus next-building WebGL preview likewise uses 60s. `v11-world-environment`'s local-only drag-gesture case is timing-sensitive on software WebGL and remains CI-skipped by design.

## Current Release

- Public version: `v1.3.1`
- Android `versionCode`: `17`
- Package: `com.blockcolc.app`
- Formal signer SHA-256: `6405e2ff95a32549699a3081372e8462317bee717c08caabf67678f211ddc6e3`
- Release APK SHA-256: recorded in `artifacts/release/v1.3.1/release-evidence.json`
- Product baseline at release: `402` unit tests, storage and core-loop browser persistence, serialized Web Playwright `62/62`, Android JVM tests, Release Lint, signed build, GitHub redownload, and final device reinstall all pass.
- Measured development-machine times: typecheck `34.6s`, unit `33.6s`, storage E2E `3.9s`, core-loop E2E `3.6s`, serialized Web matrix `430.2s`, and prechecked Android build `71.6s`. Treat these as comparison baselines, not hard timeouts.
- GitHub Phase 1 baseline: run `31469835438` passed on commit `9b871500f8293b61c6a411606cb7f41e65f61265`; fast gate about `61s`, browser job about `7m05s` with `53` passed and `6` explicit local-only skips, unsigned Android candidate job about `3m15s`, and upload verification about `12s`.
- The E2E runner's completion-marker deadline defaults to `900s` (env override `E2E_COMPLETION_DEADLINE_MS`); the serialized Web matrix legitimately exceeds the former `300s` cap as the owned matrix grows.
- CI unsigned candidate SHA-256: `5b236a3f9708abe79abad34937854038ef635e9f84ec013c12e4ea2bf20ba87a`; package/version `com.blockcolc.app 1.2.0 (15)`. Local redownload matched its manifest and passed GitHub provenance verification. It is not an installable or publishable release artifact.

## Reference Device

- OnePlus PJX110, Android 16 / API 36, device id is recorded only in local execution evidence.
- Published V16 `1.3.0 (16)` preserves app data and matches the release APK SHA-256 after final installation. At minimum zoom, ADB wheel injection plus four settlement rotations keep every lower edge covered by continuous terrain or water with no exposed void.
- V16 internal candidate on OnePlus PJX110: formally signed `1.2.0 (15)` replacement install preserves data and matches the build APK SHA-256. Six automated settlement swipes produce 381 frames with 0.79% modern jank, 12 ms p95, 23 ms p99, 140,990 KiB total PSS, thermal status 0, and no sampled fatal/WebView crash. ADB mouse-wheel injection verifies native WebView camera zoom and reset; direct physical pinch remains a manual visual check.
- V16 terrain v4 six-seed diagnostic: median water coverage falls from 6.40% to 4.98%, maximum elevation is 47, area-weighted median land elevation changes by only 1-2 layers, and triangles remain below 1.2x v3. Reproduce with `npm run metrics:terrain -w @tomato-clock/voxel`.
- Preserve app data during candidate installation. Do not use `pm clear` for release coverage.
- Subjective 3D rotation smoothness remains a manual acceptance item even when automated frame and package checks pass.

## Required Viewports

`360x800`, `412x915`, `915x412`, `768x1024`, `1440x900`.

The mobile project owns complete product flows. Desktop runs the multi-viewport, pointer, and environment-interaction subset; renderer and lighting regressions run on both projects.

## Evidence Rules

Store generated evidence under ignored `artifacts/`. Keep the current baseline here concise; put run-specific logs, screenshots, traces, and device dumps in the corresponding artifact directory. Every copied or downloaded artifact needs a SHA-256 comparison.
- V18 candidate on OnePlus PJX110: `1.3.1 (17)` overwrite install preserves data; burst evidence `artifacts/device-qa/v18-loader2/f0` shows the full-screen loading page in the first captured frame after tapping 计时 (no source-page stall), world ready ~2.5s later; launch burst `v18-boot/f2-f3` shows boot and world rebuild as one continuous loading page. Settings/tasks/stats/settings sweep screenshots under `artifacts/device-qa/v18-loader3/`.
- V18 E2E: 65/66 pass; the `v11-world-environment` canvas-drag gesture case times out identically on the pre-change tree (desktop GPU environment, skipped on CI by design) and is not a V18 regression.
- The ColorOS security layer blocks adb `pm revoke`/`appops` notification-permission changes, so the denied-state "打开系统设置" jump remains a manual user check.

## 2026-08-15 CI scope change

- GitHub Actions now runs only the fast quality gate (`npm run test:fast`). The browser release matrix and the unsigned Android candidate left CI: GitHub's software WebGL intermittently times out pointer gestures and never reliably flushes timer-driven frames, so those runs were a flaky lottery duplicating local work. The signed build, the full web E2E matrix, and real-device acceptance remain local/device-owned. `Publish-Release.ps1`'s CI green gate now checks the fast gate run.
