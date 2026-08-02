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

interface DirectNativeInputBridge {
  readSnapshot(): string;
}

function directNativeInputBridge(): DirectNativeInputBridge | null {
  if (!isCapacitorNative()) return null;
  const candidate = (globalThis as { BlockcolcNativeInput?: unknown }).BlockcolcNativeInput;
  if (!candidate || typeof candidate !== 'object') return null;
  const readSnapshot = (candidate as { readSnapshot?: unknown }).readSnapshot;
  return typeof readSnapshot === 'function' ? candidate as DirectNativeInputBridge : null;
}

export function hasNativeInputSnapshotBridge(): boolean {
  return directNativeInputBridge() !== null;
}

export function readNativeInputSnapshot(): NativeInputDelta | null {
  const bridge = directNativeInputBridge();
  if (!bridge) return null;
  try {
    const value = JSON.parse(bridge.readSnapshot()) as Partial<NativeInputDelta>;
    const dx = typeof value.dx === 'number' ? value.dx : Number.NaN;
    const dy = typeof value.dy === 'number' ? value.dy : Number.NaN;
    const sequence = typeof value.sequence === 'number' ? value.sequence : Number.NaN;
    const nativeInputUptimeMs = typeof value.nativeInputUptimeMs === 'number' ? value.nativeInputUptimeMs : Number.NaN;
    const nativeDispatchUptimeMs = typeof value.nativeDispatchUptimeMs === 'number' ? value.nativeDispatchUptimeMs : Number.NaN;
    if (typeof value.active !== 'boolean'
      || !Number.isFinite(dx)
      || !Number.isFinite(dy)
      || !Number.isFinite(sequence)
      || !Number.isFinite(nativeInputUptimeMs)
      || !Number.isFinite(nativeDispatchUptimeMs)) return null;
    return {
      active: value.active,
      dx,
      dy,
      sequence,
      nativeInputUptimeMs,
      nativeDispatchUptimeMs,
    };
  } catch {
    return null;
  }
}

export async function subscribeNativeInput(listener: (sample: NativeInputDelta) => void): Promise<() => Promise<void>> {
  if (!isCapacitorNative()) return async () => undefined;
  const handle = await NativeInput.addListener('inputFrame', listener);
  return () => handle.remove();
}
