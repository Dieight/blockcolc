import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNative: true,
  platform: 'android',
  cancelLocal: vi.fn(),
  scheduleLocal: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  checkExact: vi.fn(),
  changeExact: vi.fn(),
  showBreak: vi.fn(),
  cancelBreak: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mocks.isNative,
    getPlatform: () => mocks.platform,
  },
  registerPlugin: () => ({}),
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    cancel: mocks.cancelLocal,
    schedule: mocks.scheduleLocal,
    checkPermissions: mocks.checkPermissions,
    requestPermissions: mocks.requestPermissions,
    checkExactNotificationSetting: mocks.checkExact,
    changeExactNotificationSetting: mocks.changeExact,
  },
}));

vi.mock('../src/lifecycle', () => ({
  setNativeProductSystemUiOpen: vi.fn(async () => undefined),
}));

vi.mock('../src/break-live-update', () => ({
  breakNotificationKey: (notification: { endsAt: string; completedRounds?: number; totalRounds?: number; nextTaskTitle?: string; returnToFocus?: boolean }) => [
    'break', notification.endsAt, notification.completedRounds ?? '', notification.totalRounds ?? '', notification.nextTaskTitle ?? '', notification.returnToFocus === true ? 'return' : '',
  ].join('\u0000'),
  showBreakLiveUpdate: mocks.showBreak,
  cancelBreakLiveUpdate: mocks.cancelBreak,
  cancelFocusLiveUpdate: vi.fn(),
  showFocusLiveUpdate: vi.fn(),
}));

import { BREAK_COMPLETION_NOTIFICATION_ID, CapacitorNotificationPort } from '../src/notification-port';

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const baseNotification = (endsAt: string) => ({
  endsAt,
  completedRounds: 1,
  totalRounds: 3,
  nextTaskTitle: '下一项',
  returnToFocus: true,
});

describe('Capacitor break notification deadline ownership', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.isNative = true;
    mocks.platform = 'android';
    mocks.cancelLocal.mockResolvedValue(undefined);
    mocks.scheduleLocal.mockResolvedValue(undefined);
    mocks.checkPermissions.mockResolvedValue({ display: 'granted' });
    mocks.checkExact.mockResolvedValue({ exact_alarm: 'granted' });
    mocks.showBreak.mockResolvedValue({ deadlineAlarmScheduled: true });
    mocks.cancelBreak.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hands one real expired break to native without a duplicate drawer alarm', async () => {
    let releaseNative: (() => void) | undefined;
    const nativeStarted = new Promise<void>(resolve => { releaseNative = resolve; });
    mocks.showBreak
      .mockImplementationOnce(async () => {
        await nativeStarted;
        return { deadlineAlarmScheduled: true };
      })
      .mockResolvedValue({ deadlineReminderPosted: true });

    const port = new CapacitorNotificationPort();
    const endsAt = new Date(Date.now() + 20).toISOString();
    const notification = baseNotification(endsAt);
    const initial = port.scheduleBreakCompletion(notification);
    await wait(35);
    expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(endsAt));
    const due = port.scheduleBreakCompletion({ ...notification, deadlineReached: true });
    releaseNative!();
    await Promise.all([initial, due]);

    expect(mocks.showBreak).toHaveBeenCalledTimes(2);
    expect(mocks.scheduleLocal).not.toHaveBeenCalled();
    // A repeated ready render is idempotent after the native receiver has
    // posted the reminder; it cannot resurrect a second OS record.
    await port.scheduleBreakCompletion({ ...notification, deadlineReached: true });
    expect(mocks.showBreak).toHaveBeenCalledTimes(2);
    expect(mocks.scheduleLocal).not.toHaveBeenCalled();

    await port.cancelBreakCompletion();
    expect(mocks.cancelBreak).toHaveBeenCalledOnce();
    expect(mocks.cancelLocal).toHaveBeenCalledWith({ notifications: [{ id: BREAK_COMPLETION_NOTIFICATION_ID }] });
  });

  it('uses the ordinary local alarm when native permission rejects a due reminder', async () => {
    mocks.showBreak.mockRejectedValueOnce(new Error('permission denied'));
    const port = new CapacitorNotificationPort();
    const endsAt = new Date(Date.now() - 1).toISOString();

    await port.scheduleBreakCompletion({ ...baseNotification(endsAt), deadlineReached: true });

    expect(mocks.scheduleLocal).toHaveBeenCalledWith(expect.objectContaining({
      notifications: [expect.objectContaining({
        id: BREAK_COMPLETION_NOTIFICATION_ID,
        extra: expect.objectContaining({ deadlineReached: true }),
      })],
    }));
    expect(mocks.scheduleLocal.mock.calls.at(-1)?.[0].notifications[0]).not.toHaveProperty('schedule');
  });
});
