import { describe, expect, it } from 'vitest';
import { BREAK_COMPLETION_NOTIFICATION_ID, BREAK_NOTIFICATION_ID, FOCUS_NOTIFICATION_ID, acknowledgeAutomaticContinuation, addAutomaticContinuationListener, breakLiveUpdateOptions, breakNotificationKey, cancelAutomaticContinuation, cancelAutomaticContinuations, focusLiveUpdateOptions, focusNotificationKey, getBreakLiveUpdateCapability, getPendingAutomaticContinuations, mapPermission, openBreakLiveUpdateSettings, scheduleAutomaticContinuation } from '../src/index';

describe('Capacitor notification contract', () => {
  it('uses one stable Android notification identifier', () => { expect(FOCUS_NOTIFICATION_ID).toBe(42001); });
  it('separates the visible break live update from the at-time completion alarm', () => {
    expect(BREAK_NOTIFICATION_ID).toBe(42002);
    expect(BREAK_COMPLETION_NOTIFICATION_ID).toBe(42003);
  });
  it('uses a stable key to suppress lifecycle-driven reposts of the same break', () => {
    const first = { endsAt: '2026-08-31T12:34:56.000Z', completedRounds: 2, totalRounds: 4, nextTaskTitle: '整理笔记' };
    expect(breakNotificationKey(first)).toBe(breakNotificationKey({ ...first }));
    expect(breakNotificationKey(first)).not.toBe(breakNotificationKey({ ...first, completedRounds: 3 }));
    expect(breakNotificationKey({ ...first, returnToFocus: true })).not.toBe(breakNotificationKey(first));
  });
  it('passes the return-to-focus copy flag through the same live update record', () => {
    expect(breakLiveUpdateOptions({ endsAt: '2026-08-31T12:34:56.000Z', returnToFocus: true })).toMatchObject({ kind: 'break', returnToFocus: true });
    expect(breakLiveUpdateOptions({ endsAt: '2026-08-31T12:34:56.000Z', returnToFocus: true, deadlineReached: true })).toMatchObject({ kind: 'break', returnToFocus: true, deadlineReached: true });
  });
  it('converts absolute break context for the native system chronometer', () => {
    expect(breakLiveUpdateOptions({
      endsAt: '2026-08-31T12:34:56.000Z',
      completedRounds: 2,
      totalRounds: 4,
      nextTaskTitle: '整理笔记',
    })).toEqual({
      kind: 'break',
      updateKey: ['break', '2026-08-31T12:34:56.000Z', 2, 4, '整理笔记'].join('\u0000'),
      endsAtEpochMs: Date.parse('2026-08-31T12:34:56.000Z'),
      completedRounds: 2,
      totalRounds: 4,
      nextTaskTitle: '整理笔记',
    });
  });
  it('uses one idempotent focus key and passes thematic card context to Android', () => {
    const focus = {
      sessionId: 'focus-7',
      endsAt: '2026-09-04T13:00:00.000Z',
      projectTitle: '完成 V26',
      taskTitle: '回归测试',
      marathon: true,
    };
    expect(focusLiveUpdateOptions(focus)).toEqual({
      kind: 'focus',
      updateKey: focusNotificationKey(focus),
      endsAtEpochMs: Date.parse(focus.endsAt),
      projectTitle: '完成 V26',
      taskTitle: '回归测试',
      marathon: true,
    });
    expect(focusNotificationKey(focus)).toBe(focusNotificationKey({ ...focus }));
    expect(focusNotificationKey(focus)).not.toBe(focusNotificationKey({ ...focus, sessionId: 'focus-8' }));
  });
  it.each([
    ['granted', 'granted'], ['denied', 'denied'], ['prompt', 'prompt'], ['prompt-with-rationale', 'prompt'],
  ] as const)('maps %s permission to %s', (native, application) => { expect(mapPermission(native)).toBe(application); });
  it('reports promoted notifications as unavailable outside native Android', async () => {
    await expect(getBreakLiveUpdateCapability()).resolves.toEqual({ supported: false, allowed: false, settingsAvailable: false });
    await expect(openBreakLiveUpdateSettings()).resolves.toBe(false);
  });
  it('keeps automatic continuation native-only and makes web listener cleanup harmless', async () => {
    const event = { eventId: 'authorization-a:round:2', authorizationId: 'authorization-a', scheduledAtEpochMs: 1000 };
    await expect(scheduleAutomaticContinuation(event)).resolves.toEqual({ scheduled: false, exact: false, due: false });
    await expect(getPendingAutomaticContinuations()).resolves.toEqual([]);
    await expect(cancelAutomaticContinuation(event.eventId)).resolves.toBeUndefined();
    await expect(cancelAutomaticContinuations(event.authorizationId)).resolves.toBeUndefined();
    await expect(acknowledgeAutomaticContinuation(event.eventId)).resolves.toBeUndefined();
    const listener = await addAutomaticContinuationListener(() => undefined);
    await expect(listener.remove()).resolves.toBeUndefined();
  });
});
