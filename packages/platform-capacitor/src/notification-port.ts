import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type PermissionStatus } from '@capacitor/local-notifications';
import type { BreakCompletionNotification, FocusCompletionNotification, NotificationCapability, NotificationPermission, NotificationPort } from '@tomato-clock/application';
import { setNativeProductSystemUiOpen } from './lifecycle';
import { breakNotificationKey, cancelBreakLiveUpdate, cancelFocusLiveUpdate, showBreakLiveUpdate, showFocusLiveUpdate } from './break-live-update';

export const FOCUS_NOTIFICATION_ID = 42001;
export const BREAK_NOTIFICATION_ID = 42002;
export const BREAK_COMPLETION_NOTIFICATION_ID = 42003;
const EXACT_ALARM_PROMPT_KEY = 'blockcolc-exact-alarm-prompted-v1';

export function isCapacitorNative(): boolean { return Capacitor.isNativePlatform(); }

export function mapPermission(display: PermissionStatus['display']): NotificationPermission {
  if (display === 'granted' || display === 'denied') return display;
  return display === 'prompt' || display === 'prompt-with-rationale' ? 'prompt' : 'unavailable';
}

export class CapacitorNotificationPort implements NotificationPort {
  private scheduledBreakKey: string | null = null;
  private scheduledBreakDeadlineReached = false;
  /** Serialize native/local replacement so a stale schedule cannot win a cancel race. */
  private breakNotificationTail: Promise<void> = Promise.resolve();

  async requestPermission(): Promise<NotificationCapability> {
    if (!isCapacitorNative()) return unavailable();
    let status = await LocalNotifications.checkPermissions();
    if (status.display === 'prompt' || status.display === 'prompt-with-rationale') {
      await setNativeProductSystemUiOpen(true);
      try {
        status = await LocalNotifications.requestPermissions();
      } finally {
        await setNativeProductSystemUiOpen(false);
      }
    }
    if (status.display === 'granted') await requestExactAlarmOnce();
    return this.capability(status);
  }

  async refreshCapability(): Promise<NotificationCapability> {
    if (!isCapacitorNative()) return unavailable();
    return this.capability(await LocalNotifications.checkPermissions());
  }

  async scheduleFocusCompletion(notification: FocusCompletionNotification): Promise<void> {
    if (!isCapacitorNative()) return;
    // The at-time alarm can be safely replaced because it is not visible yet.
    // The ongoing notification is updated in place by its stable session key,
    // avoiding the cancel/repost flash on lifecycle recovery.
    await LocalNotifications.cancel({ notifications: [{ id: FOCUS_NOTIFICATION_ID }] });
    await LocalNotifications.schedule({ notifications: [{
      id: FOCUS_NOTIFICATION_ID,
      title: '专注完成',
      body: '回来记录这次小任务的实际进度。',
      schedule: { at: new Date(notification.endsAt), allowWhileIdle: true },
      extra: { kind: 'focus-completed', sessionId: notification.sessionId, endsAt: notification.endsAt },
    }] });
    try {
      await showFocusLiveUpdate(notification);
    } catch (error) {
      // Completion recovery remains valid even when the OEM/system refuses a
      // promoted ongoing notification.
      console.warn('Android focus Live Update is unavailable', error);
    }
  }

  async cancelFocusCompletion(_sessionId: string): Promise<void> {
    if (!isCapacitorNative()) return;
    try {
      await cancelFocusLiveUpdate();
    } catch (error) {
      console.warn('Android focus Live Update could not be cancelled', error);
    }
    await LocalNotifications.cancel({ notifications: [{ id: FOCUS_NOTIFICATION_ID }] });
  }

  async scheduleBreakCompletion(notification: BreakCompletionNotification): Promise<void> {
    if (!isCapacitorNative()) return;
    const key = breakNotificationKey(notification);
    const deadlineReached = notification.deadlineReached === true;
    if (key === this.scheduledBreakKey && (!deadlineReached || this.scheduledBreakDeadlineReached)) return;
    return this.enqueueBreakNotification(async () => {
      // Re-check after an earlier native/local operation in this port has
      // drained. The ready projection can be rendered more than once while a
      // real deadline callback is racing the WebView.
      if (key === this.scheduledBreakKey && (!deadlineReached || this.scheduledBreakDeadlineReached)) return;
      // The native plugin owns the absolute deadline receiver for an opted-in
      // return reminder. The regular Capacitor alarm remains the honest fallback
      // when promotion/deadline delivery is unavailable; never schedule both
      // paths for one break because that creates two drawer records.
      await LocalNotifications.cancel({ notifications: [{ id: BREAK_COMPLETION_NOTIFICATION_ID }] });
      let deadlineOwnedByNative = false;
      try {
        const capability = await showBreakLiveUpdate(notification);
        deadlineOwnedByNative = notification.returnToFocus === true
          && (capability.deadlineAlarmScheduled === true
            || (deadlineReached && capability.deadlineReminderPosted === true));
      } catch (error) {
        // The standard Capacitor alarm below remains the cross-process fallback.
        console.warn('Android break Live Update is unavailable', error);
      }
      if (!deadlineOwnedByNative) {
        try {
          await LocalNotifications.schedule({ notifications: [{
            id: BREAK_COMPLETION_NOTIFICATION_ID,
            title: notification.returnToFocus === true ? '返回专注' : '休息结束',
            body: notification.returnToFocus === true ? '休息已结束，回来开始下一轮专注。' : '回来开始下一轮专注。',
            // A due fallback must display now, not schedule an invalid date
            // in the past. The original deadline remains in extra below.
            ...(!deadlineReached ? { schedule: { at: new Date(notification.endsAt), allowWhileIdle: true } } : {}),
            extra: { kind: 'break-completed', endsAt: notification.endsAt, deadlineReached },
          }] });
        } catch (error) {
          // If native posted a countdown but local fallback failed, clean that
          // visible record too; a failed replacement must not leave a stale
          // timer with no owner.
          try { await cancelBreakLiveUpdate(); } catch (cancelError) { console.warn('Android break Live Update could not be cleaned up', cancelError); }
          throw error;
        }
      }
      this.scheduledBreakKey = key;
      this.scheduledBreakDeadlineReached = deadlineReached;
    });
  }

  async cancelBreakCompletion(): Promise<void> {
    if (!isCapacitorNative()) return;
    this.scheduledBreakKey = null;
    this.scheduledBreakDeadlineReached = false;
    return this.enqueueBreakNotification(async () => {
      try {
        try {
          await cancelBreakLiveUpdate();
        } catch (error) {
          console.warn('Android break Live Update could not be cancelled', error);
        }
        await LocalNotifications.cancel({ notifications: [{ id: BREAK_COMPLETION_NOTIFICATION_ID }] });
      } finally {
        // A queued due replacement may have completed after the caller
        // cleared the visible state. Keep the in-memory key consistent with
        // the final native/local cancellation, not with that stale operation.
        this.scheduledBreakKey = null;
        this.scheduledBreakDeadlineReached = false;
      }
    });
  }

  private enqueueBreakNotification(operation: () => Promise<void>): Promise<void> {
    const next = this.breakNotificationTail.then(operation, operation);
    this.breakNotificationTail = next.then(() => undefined, () => undefined);
    return next;
  }

  private async capability(status: PermissionStatus): Promise<NotificationCapability> {
    const permission = mapPermission(status.display);
    if (permission !== 'granted') return { permission, precision: 'unavailable', canSchedule: false };
    let precision: NotificationCapability['precision'] = 'inexact';
    if (Capacitor.getPlatform() === 'android') {
      try { precision = (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted' ? 'exact' : 'inexact'; } catch { precision = 'inexact'; }
    }
    return { permission, precision, canSchedule: true };
  }
}

async function requestExactAlarmOnce(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  const current = await LocalNotifications.checkExactNotificationSetting();
  if (current.exact_alarm === 'granted' || wasExactAlarmPrompted()) return;
  markExactAlarmPrompted(true);
  await setNativeProductSystemUiOpen(true);
  try {
    await LocalNotifications.changeExactNotificationSetting();
  } catch (error) {
    markExactAlarmPrompted(false);
    throw error;
  } finally {
    await setNativeProductSystemUiOpen(false);
  }
}

function wasExactAlarmPrompted(): boolean {
  try { return localStorage.getItem(EXACT_ALARM_PROMPT_KEY) === '1'; } catch { return false; }
}

function markExactAlarmPrompted(prompted: boolean): void {
  try {
    if (prompted) localStorage.setItem(EXACT_ALARM_PROMPT_KEY, '1');
    else localStorage.removeItem(EXACT_ALARM_PROMPT_KEY);
  } catch {}
}

function unavailable(): NotificationCapability { return { permission: 'unavailable', precision: 'unavailable', canSchedule: false }; }
