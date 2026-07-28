import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { FocusLifecycleEvent, FocusLifecyclePort } from '@tomato-clock/application';
import { isCapacitorNative } from './notification-port';

export interface NativeBackgroundContext {
  screenInteractive: boolean;
  keyguardLocked: boolean;
  backgroundedAtEpochMs: number;
  productSystemUi: boolean;
}

interface FocusIntegrityPlugin {
  getLastBackgroundContext(): Promise<NativeBackgroundContext>;
}

const FocusIntegrity = registerPlugin<FocusIntegrityPlugin>('FocusIntegrity');

export function mapNativeBackgroundContext(context: NativeBackgroundContext): FocusLifecycleEvent {
  return {
    type: 'background',
    source: 'native',
    context: {
      locked: context.keyguardLocked,
      screenOff: !context.screenInteractive,
      exempt: context.productSystemUi,
      backgroundedAtEpochMs: context.backgroundedAtEpochMs,
    },
  };
}

export function createOrderedLifecycleDispatcher(
  listener: (event: FocusLifecycleEvent) => void | Promise<void>,
  readBackgroundContext: () => Promise<NativeBackgroundContext>,
) {
  let tail = Promise.resolve();
  const enqueue = (operation: () => void | Promise<void>) => {
    tail = tail.then(operation).catch(error => { console.error('Focus lifecycle reconciliation failed', error); });
  };
  return {
    background() {
      enqueue(async () => { await listener(mapNativeBackgroundContext(await readBackgroundContext())); });
    },
    foreground() {
      enqueue(async () => { await listener({ type: 'foreground' }); });
    },
    drain() { return tail; },
  };
}

export class CapacitorFocusLifecyclePort implements FocusLifecyclePort {
  async subscribe(listener: (event: FocusLifecycleEvent) => void | Promise<void>): Promise<() => Promise<void>> {
    if (!isCapacitorNative()) return async () => undefined;
    const dispatcher = createOrderedLifecycleDispatcher(
      listener,
      () => FocusIntegrity.getLastBackgroundContext(),
    );
    const appState = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        dispatcher.foreground();
        return;
      }
      dispatcher.background();
    });
    const notification = await LocalNotifications.addListener('localNotificationActionPerformed', () => {
      dispatcher.foreground();
    });
    return async () => { await appState.remove(); await notification.remove(); await dispatcher.drain(); };
  }
}

export async function registerNativeResume(onResume: () => void | Promise<void>): Promise<() => Promise<void>> {
  if (!isCapacitorNative()) return async () => undefined;
  const appState = await App.addListener('appStateChange', ({ isActive }) => { if (isActive) void onResume(); });
  const notification = await LocalNotifications.addListener('localNotificationActionPerformed', () => { void onResume(); });
  return async () => { await appState.remove(); await notification.remove(); };
}
