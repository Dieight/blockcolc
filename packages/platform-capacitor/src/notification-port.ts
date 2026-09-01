import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type PermissionStatus } from '@capacitor/local-notifications';
import type { BreakCompletionNotification, FocusCompletionNotification, NotificationCapability, NotificationPermission, NotificationPort } from '@tomato-clock/application';
import { setNativeProductSystemUiOpen } from './lifecycle';
import { cancelBreakLiveUpdate, showBreakLiveUpdate } from './break-live-update';

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
    await this.cancelFocusCompletion(notification.sessionId);
    await LocalNotifications.schedule({ notifications: [{
      id: FOCUS_NOTIFICATION_ID,
      title: '专注完成',
      body: '回来记录这次小任务的实际进度。',
      schedule: { at: new Date(notification.endsAt), allowWhileIdle: true },
      extra: { kind: 'focus-completed', sessionId: notification.sessionId, endsAt: notification.endsAt },
    }] });
  }

  async cancelFocusCompletion(_sessionId: string): Promise<void> {
    if (!isCapacitorNative()) return;
    await LocalNotifications.cancel({ notifications: [{ id: FOCUS_NOTIFICATION_ID }] });
  }

  async scheduleBreakCompletion(notification: BreakCompletionNotification): Promise<void> {
    if (!isCapacitorNative()) return;
    const key = breakNotificationKey(notification);
    if (key === this.scheduledBreakKey) return;
    // Capacitor dismisses a visible notification before it schedules another
    // notification with the same id. Keep the completion alarm separate from
    // the visible Live Update so lifecycle refreshes never cause a flash.
    await LocalNotifications.cancel({ notifications: [{ id: BREAK_COMPLETION_NOTIFICATION_ID }] });
    await LocalNotifications.schedule({ notifications: [{
      id: BREAK_COMPLETION_NOTIFICATION_ID,
      title: '休息结束',
      body: '回来开始下一轮专注。',
      schedule: { at: new Date(notification.endsAt), allowWhileIdle: true },
      extra: { kind: 'break-completed', endsAt: notification.endsAt },
    }] });
    try {
      await showBreakLiveUpdate(notification);
    } catch (error) {
      // The at-time completion notification is still valid. Live Update is an
      // OEM/system enhancement and must not make break recovery look failed.
      console.warn('Android break Live Update is unavailable', error);
    }
    this.scheduledBreakKey = key;
  }

  async cancelBreakCompletion(): Promise<void> {
    if (!isCapacitorNative()) return;
    this.scheduledBreakKey = null;
    try {
      await cancelBreakLiveUpdate();
    } catch (error) {
      console.warn('Android break Live Update could not be cancelled', error);
    }
    await LocalNotifications.cancel({ notifications: [{ id: BREAK_COMPLETION_NOTIFICATION_ID }] });
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

export function breakNotificationKey(notification: BreakCompletionNotification): string {
  return [notification.endsAt, notification.completedRounds ?? '', notification.totalRounds ?? '', notification.nextTaskTitle ?? ''].join('\u0000');
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
