# Core loop browser integration

This package is a non-visual browser harness for the first production backend vertical slice. It connects the production `IndexedDbStateRepository` and `ApplicationService` in Chromium and verifies state through their typed APIs, never through DOM text.

The Playwright flow covers empty initialization, project and subtask creation, a daily goal, absolute timer persistence, process-style service/repository recreation, delayed lifecycle recovery, notification scheduling/cancellation, progress-to-building projection, a real page reload, cancellation history, and stale revision rejection. It writes the accepted evidence to `artifacts/core-loop-result.json`.

Run from this directory:

```powershell
npm install
npm run typecheck
npm run test:e2e
```

## Boundary

This is an integration acceptance harness, not product UI. The clock and notification adapter are deterministic fakes, while persistence is Chromium's real IndexedDB implementation. It does not prove Android WebView quota/eviction behavior, native notification delivery, process death by the Android OS, or visual rendering. Those remain separate device and UI gates.
