# Tomato Clock domain core

Pure TypeScript rules for the first-release Tomato Clock loop. The package has no UI, storage, network, or platform dependencies.

## Contract

- `DomainState` is JSON-serializable and schema-versioned. It keeps `projects[]`, one nullable `activeProjectId`, global calendar/decay policy, and a separate condition runtime for each project.
- `execute(state, command, clock)` is the only mutation entry point. It returns either a new state plus explicit events, or the unchanged input state plus a stable error code.
- The caller supplies command IDs and a `Clock`, making replay and tests deterministic.
- Focus timing uses persisted absolute `startedAt` and `endsAt`. An elapsed session must be completed and cannot be relabeled as interrupted.
- Completed focus uses its persisted `endsAt` as `completedAt`, even after delayed process recovery. It stores the start-time IANA zone and freezes the completion local date, so later time-zone changes do not rewrite daily-goal history.
- User-reported task progress is monotonic. Building condition is separate and may decay or repair.
- Each progress report cites one or more completed, same-subtask focus sessions. A session can support only one report, preserving the "focus, then report" sequence without mutating append-only focus history.
- A first positive progress report locks subtask add/remove. Rename and reorder remain allowed.
- Completed projects become monuments; their current condition is retained and never decays again. Sealing clears `activeProjectId`, allowing the next project to be created without deleting history.
- Daily goals count completed Pomodoros across subtasks and emit `DailyGoalReached` only once. Disabling a goal stops future reward evaluation without retracting an existing reached fact.
- Progress and condition use integer basis points (`0..10000`) throughout the domain and persistence boundary. The UI is responsible for converting basis points to a displayed percentage.
- Decay defaults off with two planned focus days of grace and a `2x` repair multiplier. Enabling/configuring it requires a non-negative grace and an explicit `damagePerMissedPlannedDayBasisPoints`; policy/calendar changes reset active-project inactivity anchors to avoid retroactive penalties.
- Subtask IDs are never reusable. Deletion is rejected when any active or historical focus/progress record references the subtask, and a successfully deleted ID is retained as a tombstone.
- Failed commands always return the exact input state reference (`result.state === input`); successful commands return a cloned next state.
- Persisted or imported data must enter through `parseDomainState(raw)`. The v1 parser rejects unknown/missing fields, non-finite or fractional integers, invalid dates/zones, broken ownership, reused IDs, impossible timelines, and inconsistent derived state; it returns a deep anti-aliasing clone or a stable `DomainStateValidationError`.

Weekdays use JavaScript numbering: Sunday is `0`, Saturday is `6`. Dates use `YYYY-MM-DD`; instants use ISO 8601 UTC strings; time zones must be valid IANA identifiers.

## Commands

```powershell
npm install
npm run typecheck
npm test
```

## Integration boundaries

Persistence must atomically save the returned state and append/dispatch its events. Notification and lifecycle adapters should issue `CompleteFocus` after `endsAt`; they must not infer completion by counting JavaScript ticks.

The package intentionally does not choose a decay damage percentage, decoration type, blueprint schema, or Minecraft resource policy. Those belong to product configuration and later packages.
