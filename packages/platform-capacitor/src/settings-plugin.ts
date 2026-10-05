import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Plugin } from '@capacitor/core';

export interface BlockcolcSettingsPlugin extends Plugin {
  openNotificationSettings(): Promise<void>;
  getBackgroundHealth(): Promise<BackgroundHealth>;
  openBatterySettings(): Promise<void>;
}

export interface BackgroundHealth {
  batteryOptimizationsIgnored: boolean;
  powerSaveMode: boolean;
  manufacturer: string;
  apiLevel: number;
  exitHistory: Array<{ timestampMs: number; reason: number; importance: number; pssKb: number; rssKb: number; process: 'app' | 'other' }>;
  rendererExitAtMs: number;
  rendererCrashed: boolean;
}

const blockcolcSettings = registerPlugin<BlockcolcSettingsPlugin>('SettingsPlugin');

/** Opens the OS app-notification settings for this app. Returns false on non-native platforms. */
export async function openSystemNotificationSettings(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  await blockcolcSettings.openNotificationSettings();
  return true;
}

export async function readBackgroundHealth(): Promise<BackgroundHealth | null> {
  if (!Capacitor.isNativePlatform()) return null;
  return blockcolcSettings.getBackgroundHealth();
}

/** Opens a user-controlled settings page; does not request a whitelist or change policy. */
export async function openSystemBatterySettings(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  await blockcolcSettings.openBatterySettings();
  return true;
}
