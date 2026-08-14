import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Plugin } from '@capacitor/core';

export interface BlockcolcSettingsPlugin extends Plugin {
  openNotificationSettings(): Promise<void>;
}

const blockcolcSettings = registerPlugin<BlockcolcSettingsPlugin>('SettingsPlugin');

/** Opens the OS app-notification settings for this app. Returns false on non-native platforms. */
export async function openSystemNotificationSettings(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  await blockcolcSettings.openNotificationSettings();
  return true;
}
