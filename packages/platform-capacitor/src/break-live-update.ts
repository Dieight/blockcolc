import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Plugin } from '@capacitor/core';
import type { BreakCompletionNotification } from '@tomato-clock/application';

export interface BreakLiveUpdateCapability {
  supported: boolean;
  allowed: boolean;
  settingsAvailable: boolean;
  requested?: boolean;
  promotableCharacteristics?: boolean;
  promoted?: boolean;
  liveUpdateEligible?: boolean;
}

interface BreakLiveUpdatePlugin extends Plugin {
  show(options: {
    endsAtEpochMs: number;
    completedRounds?: number;
    totalRounds?: number;
    nextTaskTitle?: string;
  }): Promise<BreakLiveUpdateCapability>;
  getCapability(): Promise<BreakLiveUpdateCapability>;
  openPromotionSettings(): Promise<{ opened: boolean }>;
  cancel(): Promise<void>;
}

const nativeBreakLiveUpdate = registerPlugin<BreakLiveUpdatePlugin>('BreakLiveUpdate');

export function breakLiveUpdateOptions(notification: BreakCompletionNotification): Parameters<BreakLiveUpdatePlugin['show']>[0] {
  return {
    endsAtEpochMs: Date.parse(notification.endsAt),
    ...(notification.completedRounds === undefined ? {} : { completedRounds: notification.completedRounds }),
    ...(notification.totalRounds === undefined ? {} : { totalRounds: notification.totalRounds }),
    ...(notification.nextTaskTitle === undefined ? {} : { nextTaskTitle: notification.nextTaskTitle }),
  };
}

/**
 * Posts an OS-rendered countdown. Android owns the per-second chronometer, so
 * keeping the WebView alive is never part of timer truth or presentation.
 */
export async function showBreakLiveUpdate(notification: BreakCompletionNotification): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  await nativeBreakLiveUpdate.show(breakLiveUpdateOptions(notification));
}

export async function cancelBreakLiveUpdate(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  await nativeBreakLiveUpdate.cancel();
}

export async function getBreakLiveUpdateCapability(): Promise<BreakLiveUpdateCapability> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return { supported: false, allowed: false, settingsAvailable: false };
  }
  return nativeBreakLiveUpdate.getCapability();
}

export async function openBreakLiveUpdateSettings(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return false;
  return (await nativeBreakLiveUpdate.openPromotionSettings()).opened;
}
