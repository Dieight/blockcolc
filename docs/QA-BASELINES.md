# QA Baselines

## Current Release

- Public version: `v1.1.2`
- Android `versionCode`: `14`
- Package: `com.blockcolc.app`
- Formal signer SHA-256: `6405e2ff95a32549699a3081372e8462317bee717c08caabf67678f211ddc6e3`
- Release APK SHA-256: `6833ff3e0447e70b85ed7248aadfe7f32c70e3c22a05fe7b169a5877c8c640a1`
- Release test baseline: full low-concurrency Playwright `96` passed, `4` planned skips; unit/type/build/Capacitor/Android JVM/Lint passed.

## Reference Device

- OnePlus PJX110, Android 16 / API 36, device id is recorded only in local execution evidence.
- Preserve app data during candidate installation. Do not use `pm clear` for release coverage.
- Subjective 3D rotation smoothness remains a manual acceptance item even when automated frame and package checks pass.

## Required Viewports

`360x800`, `412x915`, `915x412`, `768x1024`, `1440x900`.

## Evidence Rules

Store generated evidence under ignored `artifacts/`. Keep the current baseline here concise; put run-specific logs, screenshots, traces, and device dumps in the corresponding artifact directory. Every copied or downloaded artifact needs a SHA-256 comparison.
