import { describe, expect, it } from "vitest";
import { createInitialState, execute, parseDomainState, type DomainCommand } from "../src/index.js";

function fixture() {
  let instant = Date.parse("2026-09-06T08:00:00Z");
  let state = createInitialState();
  const run = (command: DomainCommand) => {
    const result = execute(state, command, { now: () => new Date(instant) });
    if (result.ok) state = result.state;
    return result;
  };
  run({ type: "CreateProject", projectId: "p", title: "P", blueprintId: "cottage", subtasks: [{ id: "s", title: "S" }] });
  return { run, state: () => state, advance: (ms: number) => { instant += ms; },
    configure: (seconds: number, enabled = true) => run({ type: "ConfigureFocusIntegrity", enabled, maxEffectiveExcursions: 3, excursionThresholdSeconds: seconds }),
    start: () => run({ type: "StartFocus", sessionId: "f", subtaskId: "s", plannedDurationMs: 600_000 }) };
}

describe("configurable integrity excursion threshold", () => {
  it.each([1, 3, 15, 60])("counts strictly above %i seconds once per return", seconds => {
    const f = fixture(); expect(f.configure(seconds).ok).toBe(true); f.start();
    for (const elapsed of [seconds * 1000 - 1, seconds * 1000, seconds * 1000 + 1]) {
      f.run({ type: "RecordFocusBackgrounded", reason: "app-switch" });
      f.advance(elapsed);
      f.run({ type: "RecordFocusForegrounded" });
    }
    expect(f.state().activeFocusSession?.integrity.effectiveExcursions).toBe(1);
    f.run({ type: "RecordFocusForegrounded" });
    expect(f.state().activeFocusSession?.integrity.effectiveExcursions).toBe(1);
  });
  it("preserves configuration through old commands and disabled periods", () => {
    const f = fixture(); f.configure(15);
    f.run({ type: "ConfigureFocusIntegrity", enabled: false, maxEffectiveExcursions: 2 });
    expect(f.state().focusIntegrityPolicy.excursionThresholdSeconds).toBe(15);
    f.start(); f.run({ type: "RecordFocusBackgrounded", reason: "web-visibility" }); f.advance(16_000);
    f.run({ type: "RecordFocusForegrounded" });
    expect(f.state().activeFocusSession?.integrity.effectiveExcursions).toBe(0);
    f.run({ type: "ConfigureFocusIntegrity", enabled: true, maxEffectiveExcursions: 2 });
    expect(f.state().focusIntegrityPolicy.excursionThresholdSeconds).toBe(15);
  });
  it.each([0, 61, 1.5, NaN, Infinity, "3", null])("rejects invalid command/persisted value %s", value => {
    const f = fixture(); const before = f.state();
    const result = f.configure(value as number);
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(result.state).toBe(before);
    const raw = structuredClone(before); raw.focusIntegrityPolicy.excursionThresholdSeconds = value as number;
    expect(() => parseDomainState(raw)).toThrow();
  });
  it("migrates schema 11 without modifying ongoing or deferred session facts", () => {
    const f = fixture(); f.start(); f.run({ type: "RecordFocusBackgrounded", reason: "app-switch" });
    const session = { ...f.state().activeFocusSession!, subtaskId: null, marathon: true as const, deferredSettlement: true as const };
    const raw = { ...f.state(), activeFocusSession: session, schemaVersion: 11, focusIntegrityPolicy: { enabled: false, maxEffectiveExcursions: 5 } };
    expect(parseDomainState(raw)).toEqual({ ...f.state(), activeFocusSession: session, focusIntegrityPolicy: { ...raw.focusIntegrityPolicy, excursionThresholdSeconds: 3 } });
    expect(() => parseDomainState({ ...raw, focusIntegrityPolicy: { ...raw.focusIntegrityPolicy, extra: true } })).toThrow();
    expect(() => parseDomainState({ ...raw, schemaVersion: 12 })).toThrow();
  });
  it("uses the saved foreground policy and interrupts at the configured count", () => {
    const f = fixture(); f.configure(15); f.start();
    f.run({ type: "RecordFocusBackgrounded", reason: "app-switch" });
    f.advance(4_000);
    f.run({ type: "ConfigureFocusIntegrity", enabled: true, maxEffectiveExcursions: 1, excursionThresholdSeconds: 3 });
    const result = f.run({ type: "RecordFocusForegrounded" });
    expect(result).toMatchObject({ ok: true, events: [
      { type: "FocusExcursionRecorded", effectiveExcursions: 1, maxEffectiveExcursions: 1 },
      { type: "FocusInterrupted", reason: "app-switch-limit" },
    ] });
    expect(f.state().activeFocusSession).toBeNull();
  });
  it("retains exemptions and completion priority with a custom threshold", () => {
    const f = fixture(); f.configure(1); f.start();
    for (const reason of ["screen-lock", "system-exempt"] as const) {
      f.run({ type: "RecordFocusBackgrounded", reason }); f.advance(2_000);
      f.run({ type: "RecordFocusForegrounded" });
    }
    expect(f.state().activeFocusSession?.integrity.effectiveExcursions).toBe(0);
    f.run({ type: "RecordFocusBackgrounded", reason: "app-switch" }); f.advance(600_000);
    f.run({ type: "RecordFocusForegrounded" });
    expect(f.state().focusHistory[0]?.status).toBe("completed");
  });
});
