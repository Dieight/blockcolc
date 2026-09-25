import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@tomato-clock/domain';
import { attachFocusExport } from './focus-export-coordinator';

vi.mock('@tomato-clock/platform-capacitor', () => ({ nativeFocusExport: {} }));
const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(stop => stop()); vi.useRealTimers(); });
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
function setup(available = true, enrolledDate = '2026-09-19') {
  let listener = (_event: { replacement: boolean }) => {};
  let planListener = () => {};
  let plan: unknown = null;
  const snapshot = vi.fn(() => createInitialState());
  const subscribeCommitted = vi.fn((next: typeof listener) => { listener = next; return vi.fn(); });
  const publish = vi.fn(async (_value: { snapshot: unknown; days: unknown; replacement: boolean }) => {});
  const stop = attachFocusExport({ snapshot, subscribeCommitted }, {
    native: { availability: async () => ({ available, enrolledDate }), publish },
    now: () => '2026-09-19T01:05:00.000Z',
    savedPlan: () => plan,
    subscribePlan: next => { planListener = next; return vi.fn(); },
  });
  disposers.push(stop);
  return { snapshot, subscribeCommitted, publish, change: (replacement = false) => listener({ replacement }),
    setPlan: (next: unknown) => { plan = next; planListener(); } };
}
describe('optional integrated relay', () => {
  it('retries an initial native scheduling rejection without another user operation', async () => {
    vi.useFakeTimers();
    const f = setup();
    f.publish.mockRejectedValueOnce(Error('Private relay unavailable'));
    await flush();
    expect(f.publish).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(f.publish).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await flush();
    expect(f.publish).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300000);
    expect(f.publish).toHaveBeenCalledTimes(2);
  });
  it('standard build performs no domain projection or subscription', async () => {
    const fixture = setup(false); await flush();
    expect(fixture.snapshot).not.toHaveBeenCalled();
    expect(fixture.subscribeCommitted).not.toHaveBeenCalled();
    expect(fixture.publish).not.toHaveBeenCalled();
  });
  it('exports saved exact breaks without guessing legacy starts or reading current settings', async () => {
    const f = setup(); await flush();
    const plan = { projectId: 'p', subtaskId: null, mode: 'marathon', totalRounds: 2, completedRounds: 1,
      reportedSessionIds: [], status: 'break', breakEndsAt: '2026-09-19T01:10:00.000Z' };
    f.setPlan(plan); await flush();
    expect(f.publish).toHaveBeenCalledTimes(1); // Unknown legacy break is not reported as idle.
    f.setPlan({ ...plan, breakStartedAt: '2026-09-19T01:00:00.000Z' }); await flush();
    expect(f.publish.mock.lastCall?.[0].snapshot).toMatchObject({ value: { currentName: '休息', estimatedElapsedMs: 300000 } });
    f.setPlan(null); await flush();
    expect(f.publish.mock.lastCall?.[0].snapshot).toMatchObject({ value: { currentName: null } });
  });
  it('does not silently drop enrollment history beyond a year', async () => {
    const f = setup(true, '2024-01-01'); await flush();
    const days = f.publish.mock.lastCall?.[0].days as { date: string }[];
    expect(days.length).toBeGreaterThan(900);
    expect(days[0]?.date).toBe('2024-01-01');
    expect(days.at(-1)?.date).toBe('2026-09-19');
  });
  it('coalesces bursts and retains replacement until successful native acknowledgement', async () => {
    vi.useFakeTimers();
    const f = setup(); await flush();
    let release!: () => void;
    f.publish.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    f.change();
    for (let i = 0; i < 50; i++) f.change(i === 5);
    expect(f.publish).toHaveBeenCalledTimes(2);
    f.publish.mockRejectedValueOnce(Error('storage unavailable'));
    release(); await flush();
    expect(f.publish).toHaveBeenCalledTimes(3);
    expect(f.publish.mock.lastCall?.[0].replacement).toBe(true);
    await vi.advanceTimersByTimeAsync(5000); await flush();
    expect(f.publish).toHaveBeenCalledTimes(4);
    expect(f.publish.mock.lastCall?.[0].replacement).toBe(true);
  });
});
