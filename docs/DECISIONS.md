# Confirmed Decisions

This file records decisions that affect workflow, source boundaries, or release evidence. Product behavior remains in `C:\Codex\Tomato Clock.md`.

## 2026-08-10 Workflow V2

- Test source, test configuration, and synthetic fixture generators are versioned in the public repository. Real user data, third-party blueprint samples, credentials, build outputs, logs, screenshots, and reports remain local.
- The repository root `version.json` is the only editable version source. Package manifests, the lockfile, Android `versionCode`/`versionName`, and the About UI are derived or checked from it.
- Work is tracked in a version packet before implementation. Product scope, non-goals, risks, acceptance, and evidence are separated from long-term history.
- Release is two-stage: `Prepare-Release.ps1` builds and emits evidence; `Publish-Release.ps1` requires explicit confirmation, revalidates the evidence, then commits, pushes, publishes, redownloads, verifies, and optionally installs.
- Internal progress does not increment the patch version. A version changes when a coherent accumulated update is ready for a Release.
- SHA-256 is a blocking comparison at every artifact boundary: build, copy, upload, redownload, install, and handoff. A logged digest without comparison is insufficient.
- Authorized Android devices are part of the post-build gate for significant daily-flow, renderer-performance, or primary-UI changes; installation must retain app data and be covered by automated checks where possible.

## 2026-08-10 Scope Hygiene

- `Tomato Clock.md` is now a concise current contract. The pre-restructure document is archived outside the public repository for historical traceability.
- `DESIGN.md` and `ARCHITECTURE.md` remain detailed technical references; current product behavior wins when older sections conflict.

## 2026-08-10 V15 Original Lighting

- V15 retains the Three.js WebGL2 forward renderer and uses third-party shader screenshots only as visual research. Shader-pack source and assets are not copied, executed, or distributed.
- The former Water/Mist high-quality experiment is replaced by Auto, Performance, Balanced, and Cinematic lighting presets. Enabled legacy experiments migrate to Cinematic; other legacy states migrate to Auto.
- Cinematic adds bounded half-resolution bloom after the normal scene render. Every requested high-quality frame refreshes the current Bloom texture, including rotation, pinch, native input, and camera settling; stale screen-space glow is never reused, and request-on-demand scheduling still prevents an idle render loop.
- Runtime quality downgrade remains authoritative over the stored request. Visual quality may fall back without changing product data or the user's stored preference.
- Construction outlines are a local three-state preference: off, current building by default, or all unfinished buildings. Only exposed shell voxels use a lit translucent material. Newly imported Litematic blueprints use deterministic support-aware ordering, while existing saved blueprint order remains unchanged.

## 2026-08-11 Test Gate Ownership

- The edit loop uses affected package checks and exact targeted E2E instead of the complete release matrix.
- `npm run test:fast` is the coherent-change checkpoint: version consistency, complete typecheck, and all unit tests. It is not required after every small edit.
- Android/mobile Chromium owns complete product behavior flows. Desktop Chromium owns responsive viewport, mouse/pointer, and desktop environment interaction. Renderer and lighting regressions remain cross-project because viewport and GPU-path differences are material.
- Release preparation reuses the version, fixture, and TypeScript results already established by its enclosing quality gate. The nested Android build still performs the production asset build, Capacitor sync, JVM tests, Release Lint, formal signing, and APK verification.
- Publish-time staged-state, upload, redownload, install, and SHA-256 comparisons remain mandatory because they verify artifact boundaries rather than repeat behavioral coverage.

## 2026-08-11 Hybrid Android CI Phase 1

- The public repository uses GitHub Actions for reproducible committed-source checks. Pull requests run the checkpoint gate; `main`, `release/**`, and manual runs add the browser release gate and an unsigned Android Release candidate.
- Phase 1 never uploads the formal keystore or passwords. The unsigned candidate uses the Release variant, is explicitly marked non-installable/non-publishable, and does not use the abandoned debug signature.
- GitHub Actions are pinned to full commit SHAs with read-only repository permissions by default. Only the candidate provenance step receives `id-token: write` and `attestations: write`.
- CI records source commit, package/version, size, and APK SHA-256 in a structured manifest, attests the APK, then redownloads and compares the uploaded candidate in a separate job.
- CI fixes the browser timezone to `Asia/Shanghai` so local-time product tests are deterministic, and uses one Web worker because GitHub's software WebGL renderer cannot sustain two concurrent 3D scenes. Real local fixtures and the synchronous hardware gesture case are explicit local-only coverage rather than false CI failures.
- Real third-party Litematic fixtures, formal signing, ADB installation, GPU/WebView behavior, and subjective device acceptance remain local. Existing local prepare/publish scripts remain the authoritative release path until a later explicitly approved signing phase.

## 2026-08-11 V16 Terrain, Sampling, And Timer Layout

- Natural Valley advances to deterministic terrain generation version 4. Existing version-3 Natural Valley worlds automatically rebuild only their derived terrain while retaining the exact seed, settlement layout, roads, buildings, tasks, and progress. Classic Island remains visually unchanged.
- Water reduction targets small rectangular fragments and excessive coverage without severing downhill drainage. Shoreline geometry may refine independently of the coarse hydrology grid, while protection zones and request-on-demand generation remain mandatory.
- Mountain work raises the upper elevation tail and extends ridgelines instead of multiplying all terrain height. Common settlement framing remains tied to buildings and the protected core, not distant peaks or the maximum legal imported-building height.
- Moire mitigation first addresses imported-atlas minification and Cinematic offscreen edge sampling, then isolates any remaining shadow shimmer. V16 does not introduce temporal antialiasing, history buffers, or a continuous render loop.
- Before a plan starts, the dominant duration is the complete plan: focus duration times rounds plus breaks only between rounds. Once focus or rest begins, the dominant timer returns to the authoritative current-stage end timestamp.
- Tasks, Statistics, and Settings keep bottom-navigation and safe-area clearance, but do not stack an additional large decorative page tail above it.
- Visible night glows select actual emissive voxel coordinates independently from clustered point-light centroids and use a bounded soft-square sprite. This preserves the two-light performance ceiling without presenting floating spherical light sources.
- Terrain water is an opaque, depth-writing surface. The product has no true sky-reflection pass, so transmitting camera-facing star points through water is treated as a rendering defect rather than a reflection effect.
- Camera composition remains tied to the settlement core, while near/far clipping uses a separate full-terrain visibility bound. This keeps buildings readable without clipping the expanded V16 mountain ring at maximum zoom.
