import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Plugin } from '@capacitor/core';

interface FocusExportPlugin extends Plugin {
  availability(): Promise<{ available: boolean; enrolledDate?: string }>;
  publish(options: { snapshot: unknown; days: unknown; replacement: boolean }): Promise<void>;
}
const plugin = registerPlugin<FocusExportPlugin>('FocusExport');

/** Optional same-app bridge; standard builds return unavailable before projection. */
export const nativeFocusExport = {
  availability: () => Capacitor.isNativePlatform() ? plugin.availability() : Promise.resolve({ available: false } as { available: boolean; enrolledDate?: string }),
  publish: (options: { snapshot: unknown; days: unknown; replacement: boolean }) => plugin.publish(options),
};
