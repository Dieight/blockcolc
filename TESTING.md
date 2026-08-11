# Testing

Test source and configuration are versioned. Real `.litematic` samples stay local because they are third-party or user-provided artifacts; their expected size and SHA-256 are recorded in `tools/test-fixtures.json`.

Run commands from `C:\Codex\tomato-clock`. Use the smallest gate that can detect the current change, then widen coverage at a checkpoint or release boundary.

## 1. Edit Loop

During implementation, run the affected package's typecheck and unit tests plus the exact browser scenario that covers the change. Examples:

```powershell
npm run typecheck -w @tomato-clock/voxel
npm test -w @tomato-clock/voxel
npm run test:e2e -w @tomato-clock/web -- tests/v15-lighting-quality.spec.ts --project=mobile-chromium --workers=1
```

- Do not run the complete Web matrix after every small edit.
- Prefer the primary mobile project for task, timer, IME, backup, blueprint, and resource-pack behavior.
- Add the desktop project only for viewport layout, mouse/pointer interaction, or renderer behavior that can differ by viewport.
- Keep browser workspaces at one worker when a test exercises IndexedDB or a shared fixture.

## 2. Checkpoint Gate

Run after a coherent feature or bug fix is complete, and before asking for manual validation:

```powershell
npm run test:fast
```

`test:fast` checks version consistency, the complete workspace typecheck, and all unit tests. The current baseline is 395 unit tests and about 69 seconds on the development machine. It intentionally excludes the complete browser and Android release matrices.

## 3. Release Candidate Gate

After affected tests and `test:fast` are green, review and stage only the coherent release contents, then run:

```powershell
& .\tools\Test-FixtureHashes.ps1
& .\tools\Prepare-Release.ps1
```

`Prepare-Release.ps1` is release-only. It runs version and fixture checks, typecheck, unit tests, the two browser persistence/core-loop tests, the optimized Web release matrix, Web production build, Capacitor sync, Android JVM tests, Release Lint, formal APK build, package/version/signature checks, and connected-device coverage when an authorized device is present.

The Web release matrix has one owner for each behavior instead of executing every flow twice:

- Mobile Chromium owns complete product flows because Android is the primary platform.
- Desktop Chromium owns the responsive viewport matrix, mouse/pointer interaction, and desktop environment interaction.
- Renderer and lighting regressions run on both projects because their output can differ by viewport and GPU path.

The current local matrix schedules 59 tests with no planned project skips, down from 104 duplicated entries before ownership was assigned. Do not rerun `Prepare-Release.ps1` for an isolated tweak; return to the edit loop, run the affected test, and prepare once the release candidate is coherent.

## Publish Boundary

Publishing is separate from preparation and still requires explicit authorization:

```powershell
& .\tools\Publish-Release.ps1
```

The publish step deliberately rechecks staged state, prepared evidence, uploaded and redownloaded artifacts, and any installed APK. These are artifact-boundary comparisons, not redundant test-suite execution.

## GitHub Android CI

`.github/workflows/android-ci.yml` provides the first hybrid CI stage:

- Pull requests run only `test:fast`; they never receive signing material or produce an APK.
- Pushes to `main` and `release/**`, plus manual runs, continue through the two browser persistence/core-loop tests and the owned Web release matrix. CI fixes its browser timezone to `Asia/Shanghai` for deterministic local-time tests and uses one worker to avoid software-WebGL contention.
- Markdown-only pushes and pull requests do not start Android CI; documentation changes cannot alter the executable candidate.
- Only after those gates pass does CI build the exact Release variant without a signature. The explicit unsigned escape hatch works only inside GitHub Actions and cannot weaken the normal local Release signing requirement.
- The candidate contains a structured manifest with source commit, package/version metadata, size, and APK SHA-256. CI compares the build and packaged copies, uploads an attested artifact, redownloads it in a separate job, and compares it with the manifest.

The unsigned CI APK is evidence, not an installable or publishable application. Formal signing, local real-fixture verification, synchronous 3D gesture coverage, ADB replacement installation, physical-device rendering/performance checks, and explicit publication remain local gates during this phase. Actions are pinned to full commit SHAs; no signing secret is configured in GitHub.

## Fixture Rules

- Never replace a local fixture without updating its manifest entry and recording why in the active version packet.
- A fixture size or SHA-256 mismatch blocks the gate; do not accept a changed sample as an incidental test update.
- Real-sample unit and browser compatibility cases run only when their manifest-listed local files are present. Synthetic parser, import, resource-pack, and safety coverage always runs in CI; local release preparation still requires, hashes, and exercises the real samples.
- Prefer generated in-memory fixtures for new parser/unit tests when a real file is not required.
- Keep Playwright screenshots, traces, videos, `test-results`, `artifacts`, APKs, and logs out of Git.

## Device Rules

After significant daily-flow, renderer-performance, or primary-UI changes:

```powershell
adb devices -l
```

An authorized device receives a formally signed `-r` install with data preserved. The installed package and installed `base.apk` digest must match the candidate APK; a hash printed without comparison is not evidence.
