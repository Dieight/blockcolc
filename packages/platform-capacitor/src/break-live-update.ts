import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Plugin, PluginListenerHandle } from '@capacitor/core';
import type { BreakCompletionNotification, FocusCompletionNotification } from '@tomato-clock/application';

export interface BreakLiveUpdateCapability {
  supported: boolean;
  allowed: boolean;
  settingsAvailable: boolean;
  requested?: boolean;
  promotableCharacteristics?: boolean;
  promoted?: boolean;
  liveUpdateEligible?: boolean;
  /** True when the native deadline receiver owns the return reminder. */
  deadlineAlarmScheduled?: boolean;
  deadlineAlarmExact?: boolean;
  /** True when native posted the already-due return reminder immediately. */
  deadlineReminderPosted?: boolean;
}

export interface AutomaticContinuationDeadlineEvent {
  eventId: string;
  authorizationId: string;
  scheduledAtEpochMs: number;
}

export interface AutomaticContinuationDeadlineSchedule {
  scheduled: boolean;
  exact: boolean;
  due: boolean;
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
    returnToFocus?: boolean;
    deadlineReached?: boolean;
    projectTitle?: string;
    taskTitle?: string;
    marathon?: boolean;
  }): Promise<BreakLiveUpdateCapability>;
  getCapability(): Promise<BreakLiveUpdateCapability>;
  openPromotionSettings(): Promise<{ opened: boolean }>;
  cancel(): Promise<void>;
  cancelKind(options: { kind: TimerLiveUpdateKind }): Promise<void>;
  scheduleAutomaticContinuation(options: AutomaticContinuationDeadlineEvent): Promise<AutomaticContinuationDeadlineSchedule>;
  cancelAutomaticContinuation(options: { eventId: string }): Promise<void>;
  cancelAutomaticContinuations(options: { authorizationId: string }): Promise<void>;
  getPendingAutomaticContinuations(): Promise<{ events: AutomaticContinuationDeadlineEvent[] }>;
  acknowledgeAutomaticContinuation(options: { eventId: string }): Promise<void>;
  addListener(eventName: 'automaticContinuationDue', listenerFunc: (event: AutomaticContinuationDeadlineEvent) => void): Promise<PluginListenerHandle>;
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
    ...(notification.returnToFocus === true ? { returnToFocus: true } : {}),
    ...(notification.deadlineReached === true ? { deadlineReached: true } : {}),
  };
}

export function breakNotificationKey(notification: BreakCompletionNotification): string {
  const base = ['break', notification.endsAt, notification.completedRounds ?? '', notification.totalRounds ?? '', notification.nextTaskTitle ?? ''];
  // Keep the legacy standard key byte-for-byte stable. Only opt-in copy needs
  // a distinct identity so a reminder toggle can replace the same alarm/live
  // record without making every existing break look new.
  return notification.returnToFocus === true ? [...base, 'return'].join('\u0000') : base.join('\u0000');
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
export async function showBreakLiveUpdate(notification: BreakCompletionNotification): Promise<BreakLiveUpdateCapability> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return { supported: false, allowed: false, settingsAvailable: false };
  return nativeTimerLiveUpdate.show(breakLiveUpdateOptions(notification));
}

export async function showFocusLiveUpdate(notification: FocusCompletionNotification): Promise<BreakLiveUpdateCapability> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return { supported: false, allowed: false, settingsAvailable: false };
  return nativeTimerLiveUpdate.show(focusLiveUpdateOptions(notification));
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

/**
 * Registers the absolute next-round deadline with Android. The receiver stores
 * a due event before publishing this event to a live WebView; domain state is
 * still advanced only by the shared application service.
 */
export async function scheduleAutomaticContinuation(
  event: AutomaticContinuationDeadlineEvent,
): Promise<AutomaticContinuationDeadlineSchedule> {
  if (!isAndroidNative()) return { scheduled: false, exact: false, due: false };
  return nativeTimerLiveUpdate.scheduleAutomaticContinuation(event);
}

export async function cancelAutomaticContinuation(eventId: string): Promise<void> {
  if (!isAndroidNative()) return;
  await nativeTimerLiveUpdate.cancelAutomaticContinuation({ eventId });
}

export async function cancelAutomaticContinuations(authorizationId: string): Promise<void> {
  if (!isAndroidNative()) return;
  await nativeTimerLiveUpdate.cancelAutomaticContinuations({ authorizationId });
}

/** Returns durable due events. They remain queued until acknowledged. */
export async function getPendingAutomaticContinuations(): Promise<AutomaticContinuationDeadlineEvent[]> {
  if (!isAndroidNative()) return [];
  const result = await nativeTimerLiveUpdate.getPendingAutomaticContinuations();
  return Array.isArray(result.events) ? result.events : [];
}

export async function acknowledgeAutomaticContinuation(eventId: string): Promise<void> {
  if (!isAndroidNative()) return;
  await nativeTimerLiveUpdate.acknowledgeAutomaticContinuation({ eventId });
}

export async function addAutomaticContinuationListener(
  listener: (event: AutomaticContinuationDeadlineEvent) => void,
): Promise<PluginListenerHandle> {
  if (!isAndroidNative()) return { remove: async () => undefined };
  return nativeTimerLiveUpdate.addListener('automaticContinuationDue', listener);
}

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
