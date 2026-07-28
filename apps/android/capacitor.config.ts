import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.blockcolc.app',
  appName: '方块钟',
  webDir: '../web/dist',
  android: { allowMixedContent: false, captureInput: true },
};

export default config;
