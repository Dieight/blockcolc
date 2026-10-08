import { Capacitor, registerPlugin } from '@capacitor/core';

export interface AppUpdateAsset { version: string; url: string; size: number; sha256: string }
export interface AppUpdateStatus {
  native: boolean;
  channel: 'standard' | 'private' | 'web';
  phase: 'idle' | 'downloading' | 'paused' | 'ready' | 'failed';
  canInstall: boolean;
  version?: string;
  receivedBytes?: number;
  totalBytes?: number;
  message?: string;
}
export interface AppUpdatePort {
  status(): Promise<AppUpdateStatus>;
  start(asset: AppUpdateAsset): Promise<AppUpdateStatus>;
  cancel(): Promise<AppUpdateStatus>;
  allowInstall(): Promise<void>;
  install(): Promise<void>;
}
const plugin = registerPlugin<AppUpdatePort>('AppUpdate');
export const nativeAppUpdate: AppUpdatePort = {
  status: () => Capacitor.isNativePlatform() ? plugin.status() : Promise.resolve({ native: false, channel: 'web', phase: 'idle', canInstall: false }),
  start: asset => plugin.start(asset), cancel: () => plugin.cancel(),
  allowInstall: () => plugin.allowInstall(), install: () => plugin.install(),
};
