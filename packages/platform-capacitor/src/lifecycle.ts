import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { FocusLifecycleEvent, FocusLifecyclePort } from '@tomato-clock/application';

export interface NativeBackgroundContext {
  screenInteractive: boolean;
  keyguardLocked: boolean;
  backgroundedAtEpochMs: number;
  productSystemUi: boolean;
  /** True when the activity was still in a multi-window surface (split screen /
   * OEM floating window) at the moment it stopped. */
  multiWindow: boolean;
}

interface FocusIntegrityPlugin {
  getLastBackgroundContext(): Promise<NativeBackgroundContext>;
  setProductSystemUiOpen(options: { open: boolean }): Promise<void>;
}

const FocusIntegrity = registerPlugin<FocusIntegrityPlugin>('FocusIntegrity');

export async function setNativeProductSystemUiOpen(open: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await FocusIntegrity.setProductSystemUiOpen({ open });
}

export function mapNativeBackgroundContext(context: NativeBackgroundContext): FocusLifecycleEvent {
  return {
    type: 'background',
    source: 'native',
    context: {
      locked: context.keyguardLocked,
      screenOff: !context.screenInteractive,
      exempt: context.productSystemUi,
      multiWindow: context.multiWindow,
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
  // V23: several native channels report the same physical transition (Capacitor
  // appStateChange, onResume/onWindowFocusChanged, notification taps), so the
  // ordered queue can see background,background or foreground,foreground pairs.
  // The domain already deduplicates the pending background, but every extra
  // foreground still reloads and re-validates the whole persisted state on the
  // JS main thread — that storm made world rotation stutter for seconds after
  // returning. Coalesce same-direction duplicates that arrive back-to-back.
  let lastDirection: 'background' | 'foreground' | null = null;
  let lastDirectionAt = 0;
  const coalesce = (direction: 'background' | 'foreground', operation: () => void | Promise<void>) => {
    const now = Date.now();
    if (direction === lastDirection && now - lastDirectionAt < 600) return;
    lastDirection = direction;
    lastDirectionAt = now;
    enqueue(operation);
  };
  return {
    background() {
      coalesce('background', async () => { await listener(mapNativeBackgroundContext(await readBackgroundContext())); });
    },
    foreground() {
      coalesce('foreground', async () => { await listener({ type: 'foreground' }); });
    },
    drain() { return tail; },
  };
}

export class CapacitorFocusLifecyclePort implements FocusLifecyclePort {
  async subscribe(listener: (event: FocusLifecycleEvent) => void | Promise<void>): Promise<() => Promise<void>> {
    if (!Capacitor.isNativePlatform()) return async () => undefined;
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
    // V22 follow-up: entering/leaving a multi-window surface (split screen,
    // OEM floating window) does not fire appStateChange, so the native side
    // pushes its own signal. Both paths deduplicate in the domain layer: one
    // session can only carry a single pending background instant.
    const onMultiWindow = (event: Event) => {
      const active = (event as CustomEvent<{ active: boolean }>).detail?.active;
      if (active === true) dispatcher.background();
      else if (active === false) dispatcher.foreground();
    };
    window.addEventListener('blockcolc-multi-window', onMultiWindow);
    const notification = await LocalNotifications.addListener('localNotificationActionPerformed', () => {
      dispatcher.foreground();
    });
    return async () => {
      await appState.remove();
      await notification.remove();
      window.removeEventListener('blockcolc-multi-window', onMultiWindow);
      await dispatcher.drain();
    };
  }
}

export async function registerNativeResume(onResume: () => void | Promise<void>): Promise<() => Promise<void>> {
  if (!Capacitor.isNativePlatform()) return async () => undefined;
  const appState = await App.addListener('appStateChange', ({ isActive }) => { if (isActive) void onResume(); });
  const notification = await LocalNotifications.addListener('localNotificationActionPerformed', () => { void onResume(); });
  return async () => { await appState.remove(); await notification.remove(); };
}
