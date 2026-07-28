import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type PermissionStatus } from '@capacitor/local-notifications';
import type { FocusCompletionNotification, NotificationCapability, NotificationPermission, NotificationPort } from '@tomato-clock/application';

export const FOCUS_NOTIFICATION_ID = 42001;

export function isCapacitorNative(): boolean { return Capacitor.isNativePlatform(); }

export function mapPermission(display: PermissionStatus['display']): NotificationPermission {
  if (display === 'granted' || display === 'denied') return display;
  return display === 'prompt' || display === 'prompt-with-rationale' ? 'prompt' : 'unavailable';
}

export class CapacitorNotificationPort implements NotificationPort {
  async requestPermission(): Promise<NotificationCapability> {
    if (!isCapacitorNative()) return unavailable();
    let status = await LocalNotifications.checkPermissions();
    if (status.display === 'prompt' || status.display === 'prompt-with-rationale') status = await LocalNotifications.requestPermissions();
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

function unavailable(): NotificationCapability { return { permission: 'unavailable', precision: 'unavailable', canSchedule: false }; }
