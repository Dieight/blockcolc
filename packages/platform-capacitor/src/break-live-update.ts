import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Plugin } from '@capacitor/core';
import type { BreakCompletionNotification, FocusCompletionNotification } from '@tomato-clock/application';

export interface BreakLiveUpdateCapability {
  supported: boolean;
  allowed: boolean;
  settingsAvailable: boolean;
  requested?: boolean;
  promotableCharacteristics?: boolean;
  promoted?: boolean;
  liveUpdateEligible?: boolean;
}

type TimerLiveUpdateKind = 'focus' | 'break';

interface TimerLiveUpdatePlugin extends Plugin {
  show(options: {
    kind: TimerLiveUpdateKind;
    updateKey: string;
    endsAtEpochMs: number;
    completedRounds?: number;
    totalRounds?: number;
    nextTaskTitle?: string;
    projectTitle?: string;
    taskTitle?: string;
    marathon?: boolean;
  }): Promise<BreakLiveUpdateCapability>;
  getCapability(): Promise<BreakLiveUpdateCapability>;
  openPromotionSettings(): Promise<{ opened: boolean }>;
  cancel(): Promise<void>;
  cancelKind(options: { kind: TimerLiveUpdateKind }): Promise<void>;
}

const nativeTimerLiveUpdate = registerPlugin<TimerLiveUpdatePlugin>('BreakLiveUpdate');

export function breakLiveUpdateOptions(notification: BreakCompletionNotification): Parameters<TimerLiveUpdatePlugin['show']>[0] {
  return {
    kind: 'break',
    updateKey: breakNotificationKey(notification),
    endsAtEpochMs: Date.parse(notification.endsAt),
    ...(notification.completedRounds === undefined ? {} : { completedRounds: notification.completedRounds }),
    ...(notification.totalRounds === undefined ? {} : { totalRounds: notification.totalRounds }),
    ...(notification.nextTaskTitle === undefined ? {} : { nextTaskTitle: notification.nextTaskTitle }),
  };
}

export function breakNotificationKey(notification: BreakCompletionNotification): string {
  return ['break', notification.endsAt, notification.completedRounds ?? '', notification.totalRounds ?? '', notification.nextTaskTitle ?? ''].join('\u0000');
}

export function focusLiveUpdateOptions(notification: FocusCompletionNotification): Parameters<TimerLiveUpdatePlugin['show']>[0] {
  return {
    kind: 'focus',
    updateKey: focusNotificationKey(notification),
    endsAtEpochMs: Date.parse(notification.endsAt),
    ...(notification.projectTitle === undefined ? {} : { projectTitle: notification.projectTitle }),
    ...(notification.taskTitle === undefined ? {} : { taskTitle: notification.taskTitle }),
    ...(notification.marathon === true ? { marathon: true } : {}),
  };
}

export function focusNotificationKey(notification: FocusCompletionNotification): string {
  return ['focus', notification.sessionId, notification.endsAt, notification.projectTitle ?? '', notification.taskTitle ?? '', notification.marathon === true ? '1' : '0'].join('\u0000');
}

/**
 * Posts an OS-rendered countdown. Android owns the per-second chronometer, so
 * keeping the WebView alive is never part of timer truth or presentation.
 */
export async function showBreakLiveUpdate(notification: BreakCompletionNotification): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  await nativeTimerLiveUpdate.show(breakLiveUpdateOptions(notification));
}

export async function showFocusLiveUpdate(notification: FocusCompletionNotification): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  await nativeTimerLiveUpdate.show(focusLiveUpdateOptions(notification));
}

export async function cancelBreakLiveUpdate(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  await nativeTimerLiveUpdate.cancelKind({ kind: 'break' });
}

export async function cancelFocusLiveUpdate(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  await nativeTimerLiveUpdate.cancelKind({ kind: 'focus' });
}

export async function getBreakLiveUpdateCapability(): Promise<BreakLiveUpdateCapability> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return { supported: false, allowed: false, settingsAvailable: false };
  }
  return nativeTimerLiveUpdate.getCapability();
}

export async function openBreakLiveUpdateSettings(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return false;
  return (await nativeTimerLiveUpdate.openPromotionSettings()).opened;
}
