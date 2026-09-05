# Workspace Instructions

This workspace's active product is Tomato Clock.

## Route The Task

- For Tomato Clock planning, implementation, diagnosis, review, release, or product questions, read `C:\Codex\tomato-clock\Tomato Clock.md` completely first.
- For product, UX, frontend, 3D progression, or visual QA work, use `$tomato-clock-product-design` and read its `SKILL.md` completely.
- For unrelated maintenance in another nested repository, follow the closest nested `AGENTS.md`; Tomato Clock context is not required unless the task touches Tomato Clock.

## Modes

- Discussion: inspect and answer; do not change files unless the user confirms a decision or asks for implementation.
- Diagnosis or review: gather evidence and report findings; do not silently implement a fix.
- Implementation: update the active version work packet, implement the confirmed scope, and verify by risk.
- Release: run `tools/Prepare-Release.ps1`, `tools/Install-ReleaseCandidate.ps1`, `tools/Accept-ReleaseCandidate.ps1`, then `tools/Publish-Release.ps1` against one immutable candidate; recording acceptance and publishing each require the corresponding explicit user authorization.

## Product Authority

- Treat `Tomato Clock.md` as the canonical source for current goals, settled scope, deferred work, and open decisions.
- Do not silently resolve `开放问题` when they affect stored data, user expectations, licensing, compatibility, or product scope.
- When the user confirms a product decision, update `Tomato Clock.md` and the current `docs/versions/V*.md` work packet in the same task unless the request is discussion-only.
- Keep implementation local-first and inside the documented boundary unless the user explicitly expands it.

## Verification

- Versioned test source, configuration, and synthetic fixture generators are part of the product source. Real user data, third-party sample files, credentials, build outputs, logs, and reports stay untracked.
- After significant daily-flow, renderer-performance, or primary-UI changes, check `adb devices -l`. If an authorized Android device is connected, install the current formally signed candidate without clearing data and finish automatable device checks before declaring completion.
- At every artifact boundary, including build, copy, upload, redownload, install, and handoff, compute SHA-256 and compare it with the previous boundary or controlled manifest. Printing a digest without comparing it is not verification. Any mismatch blocks installation, release, and handoff.
- Do not bump a version or create a Release for ordinary internal progress. Accumulate related changes and publish only when explicitly requested.
