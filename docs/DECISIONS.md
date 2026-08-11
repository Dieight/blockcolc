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
