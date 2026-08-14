# Changelog

User-facing release notes are kept here; internal diagnosis and per-run evidence belong in `docs/QA-BASELINES.md` or ignored artifacts.

## v1.3.1 - 2026-08-14

- Preserved unfinished focus plans across navigation and ordinary lifecycle recovery so returning to work restores the same project, subtask, round count, and timer stage.
- Added compact building memory, clearer effective-focus statistics, recent rhythm durations, and project allocation while retaining the 26-week heatmap.
- Reorganized task summaries into current, paused, habit, and completed/monument groups, with a standard-size multi-project task overview after current-task details.
- Added a read-only notification capability state and kept Android end-of-focus and end-of-break reminders honest about best-effort delivery.
- Raised bounded resource-pack import limits and added Android cache-backed chunk transport so larger 16x packs can import without bridge stack overflow or the old file-count gate.

## v1.3.0 - 2026-08-11

- Rebuilt Natural Valley terrain with fewer fragmented rectangular pools, refined shorelines, longer ridges, and a higher mountain tail while preserving settlement seeds and progress.
- Reduced distant texture shimmer with isolated resource-pack mipmaps, smoother original-material minification, and bounded Cinematic edge sampling.
- Fixed maximum-zoom mountain clipping, oversized floating night halos, and stars leaking through terrain water.
- The idle timer now shows the complete multi-round plan duration, and primary mobile pages use their available height with less wasted spacing.

## v1.2.0 - 2026-08-11

- Added Auto, Performance, Balanced, and Cinematic original lighting presets with bounded Bloom, improved water, glass, emissive materials, and brighter readable nights.
- Kept Cinematic light halos synchronized during rotation and zoom without introducing an idle render loop or full-screen brightness switching.
- Added off, current-building, and all-building construction-outline options using a lit exposed shell instead of bright white placeholder volumes.
- Newly imported Litematic buildings now use deterministic support-aware construction order while existing saved blueprints retain their stored order.
- Fixed Android night stars disappearing at the farthest settlement zoom and prevented compact 26-week heatmap month labels from overlapping.

## v1.1.2 - 2026-08-10

- Improved stable-seed watershed terrain, widening streams, lake basins, and building/road protection zones.
- Daily goals now start automatically at eight rounds and save immediately; complete and early focus both count.
- Updated 26-week effective-focus heatmap thresholds to `0 / 90 / 180 / 270 / 360` minutes.
- Added persistent names for local blueprint-library entries and fixed Android Chinese composition input when saving a name.

## v1.1.1 - 2026-08-09

- Added original fallback material patterns for unsupported blocks while preserving user-imported resource-pack priority.

## v1.1.0 - 2026-08-08

- Added second-generation terrain, hydrology, support masks, LOD, and broader Minecraft Java block-model compatibility.
