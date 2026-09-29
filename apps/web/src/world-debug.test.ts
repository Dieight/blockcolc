import { describe, expect, it } from 'vitest';
import { NORMAL_WORLD_DEBUG, debugTimeLabel, parseDebugTime, projectWorldDebug } from './world-debug';

describe('session-only world presentation overrides', () => {
  it('turning off releases every override rather than keeping a frozen projection', () => {
    const settings = { ...NORMAL_WORLD_DEBUG, weather: 'storm' as const, timeMinutes: 60, decayAmount: 1 };
    expect(projectWorldDebug(settings, Date.now())).toBeNull();
    expect(projectWorldDebug({ ...settings, enabled: true }, Date.now())).toMatchObject({ weather: { kind: 'rain', precipitationIntensity: 1 }, decayAmount: 1 });
    expect(projectWorldDebug({ ...settings, enabled: false }, Date.now())).toBeNull();
  });
  it('inherits unselected sources without generating fake clear weather', () => {
    expect(projectWorldDebug({ ...NORMAL_WORLD_DEBUG, enabled: true }, Date.now())).toEqual({ date: null, weather: null, decayAmount: null });
  });
  it('projects a chosen local time without changing its input or system clock', () => {
    const now = new Date(2026, 8, 27, 10, 23, 42).getTime();
    const settings = { ...NORMAL_WORLD_DEBUG, enabled: true, timeMinutes: 18 * 60 + 12 };
    const result = projectWorldDebug(settings, now)!;
    expect(new Date(result.date!).getHours()).toBe(18);
    expect(new Date(result.date!).getMinutes()).toBe(12);
    expect(new Date(result.date!).getDate()).toBe(27);
    expect(now).toBe(new Date(2026, 8, 27, 10, 23, 42).getTime());
    expect(settings).toEqual({ ...NORMAL_WORLD_DEBUG, enabled: true, timeMinutes: 1092 });
  });
  it('rejects nonfinite values and clamps visual corruption', () => {
    const settings = { ...NORMAL_WORLD_DEBUG, enabled: true, timeMinutes: NaN, decayAmount: Infinity };
    expect(projectWorldDebug(settings, Date.now())).toMatchObject({ date: null, decayAmount: null });
    expect(projectWorldDebug({ ...settings, decayAmount: -1 }, Date.now())!.decayAmount).toBe(0);
    expect(projectWorldDebug({ ...settings, decayAmount: 3 }, Date.now())!.decayAmount).toBe(1);
  });
  it('validates clock fields without accepting rollover dates', () => {
    expect(parseDebugTime('23:59')).toBe(1439);
    expect(parseDebugTime('24:00')).toBeNull();
    expect(parseDebugTime('12:60')).toBeNull();
    expect(parseDebugTime('')).toBeNull();
    expect(debugTimeLabel(65)).toBe('01:05');
  });
});
