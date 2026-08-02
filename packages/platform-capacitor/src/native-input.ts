import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isCapacitorNative } from './notification-port';

export interface NativeInputDelta {
  active: boolean;
  dx: number;
  dy: number;
  sequence: number;
  nativeInputUptimeMs: number;
  nativeDispatchUptimeMs: number;
}
interface NativeInputPlugin {
  addListener(eventName: 'inputFrame', listener: (sample: NativeInputDelta) => void): Promise<PluginListenerHandle>;
}
const NativeInput = registerPlugin<NativeInputPlugin>('NativeInput');

export async function subscribeNativeInput(listener: (sample: NativeInputDelta) => void): Promise<() => Promise<void>> {
  if (!isCapacitorNative()) return async () => undefined;
  const handle = await NativeInput.addListener('inputFrame', listener);
  return () => handle.remove();
}
