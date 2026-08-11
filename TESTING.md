# Testing

Test source and configuration are versioned. Real `.litematic` samples stay local because they are third-party or user-provided artifacts; their expected size and SHA-256 are recorded in `tools/test-fixtures.json`.

## Fast Gate

Run from `C:\Codex\tomato-clock`:

```powershell
npm run version:check
npm run typecheck
npm test
npm run test:e2e -w @tomato-clock/web -- --workers=2
```

Use a package-level E2E command for a narrow change. Keep the browser workspace at one worker when the test exercises IndexedDB or a shared fixture.

## Release Gate

```powershell
& .\tools\Test-FixtureHashes.ps1
& .\tools\Prepare-Release.ps1
```

`Prepare-Release.ps1` runs the full low-concurrency browser matrix, Web production build, Capacitor sync, Android JVM tests, Release Lint, formal APK build, package/version/signature checks, and connected-device coverage when an authorized device is present.

## Fixture Rules

- Never replace a local fixture without updating its manifest entry and recording why in the active version packet.
- A fixture size or SHA-256 mismatch blocks the gate; do not accept a changed sample as an incidental test update.
- Prefer generated in-memory fixtures for new parser/unit tests when a real file is not required.
- Keep Playwright screenshots, traces, videos, `test-results`, `artifacts`, APKs, and logs out of Git.

## Device Rules

After significant daily-flow, renderer-performance, or primary-UI changes:

```powershell
adb devices -l
```

An authorized device receives a formally signed `-r` install with data preserved. The installed package and installed `base.apk` digest must match the candidate APK; a hash printed without comparison is not evidence.
