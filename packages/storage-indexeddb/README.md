# IndexedDB storage

Production local storage adapter for Tomato Clock's single `DomainState` aggregate.

## Contract

- IndexedDB v1 owns `appState`, `rollbackBackups`, and `metadata` stores.
- `appState/current` is the only current aggregate. It carries a monotonically increasing revision, including for an empty-state tombstone. Every read and write passes through `parseDomainState` and returns a detached value.
- `load()` explicitly returns `{ state, revision }`; `save(state, expectedRevision)` uses transaction-local compare-and-swap and returns the committed revision. A stale token receives `StorageConflictError` (`STORAGE_CONFLICT`) instead of silently overwriting newer state.
- Export and preview are read-only operations and never create or refresh a write token. After any conflict, import, or restore, callers must load the latest explicit revision before saving again.
- Backup v1 has exactly `format`, `schemaVersion`, `exportedAt`, `payload`, and `checksum`. The checksum is SHA-256 over canonical JSON with recursively sorted object keys.
- Preview validates the envelope, checksum, and complete domain graph without opening a write transaction.
- Import first validates outside IndexedDB, then writes the prior state (including an empty-install marker) as a rollback and replaces `current` in one transaction. It never merges records.
- Rollbacks are immutable and retained until a future explicit retention policy is approved.

## Verification

```powershell
npm install
npm run typecheck
npm test
npm run test:e2e
```

Unit tests use `fake-indexeddb`. The Playwright test executes persistence, page reloads after replacement and restore, preview, retained rollback, and an external v2 database upgrade against a real browser IndexedDB implementation. The upgrade proves open v1 connections respond to `versionchange` without leaving the request blocked; no DOM content is used as storage evidence.

The browser test does not simulate storage quota exhaustion, browser eviction policy, or competing-tab upgrade blocking. Those remain integration risks for the installed Android WebView/PWA validation stages.
