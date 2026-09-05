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
  // Several native channels can report the same physical transition, so the
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
    // Android's Activity combines pause/resume, window focus, multi-window and
    // OEM floating-window facts before publishing one authoritative direction.
    // Listening to Capacitor appStateChange as a second Android source allowed
    // callback reordering to create a foreground/background/foreground echo.
    const appState = Capacitor.getPlatform() === 'android' ? null : await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) dispatcher.foreground();
      else dispatcher.background();
    });
    const onNativeAttention = (event: Event) => {
      const background = (event as CustomEvent<{ background: boolean }>).detail?.background;
      if (background === true) dispatcher.background();
      else if (background === false) dispatcher.foreground();
    };
    window.addEventListener('blockcolc-native-attention', onNativeAttention);
    const notification = await LocalNotifications.addListener('localNotificationActionPerformed', () => {
      dispatcher.foreground();
    });
    return async () => {
      await appState?.remove();
      await notification.remove();
      window.removeEventListener('blockcolc-native-attention', onNativeAttention);
      await dispatcher.drain();
    };
  }
}

/**
 * Android hardware back button. Attaching the listener takes over the default
 * "close activity" behavior, so the web layer must call exitAndroidApp() when
 * nothing on its overlay stack consumes the gesture.
 */
export async function subscribeHardwareBack(handler: () => void): Promise<() => Promise<void>> {
  if (!Capacitor.isNativePlatform()) return async () => undefined;
  const handle = await App.addListener('backButton', () => handler());
  return async () => { await handle.remove(); };
}

/** Closes the Android activity; a no-op outside the native container. */
export async function exitAndroidApp(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await App.exitApp();
}

export async function registerNativeResume(onResume: () => void | Promise<void>): Promise<() => Promise<void>> {
  if (!Capacitor.isNativePlatform()) return async () => undefined;
  const appState = await App.addListener('appStateChange', ({ isActive }) => { if (isActive) void onResume(); });
  const notification = await LocalNotifications.addListener('localNotificationActionPerformed', () => { void onResume(); });
  return async () => { await appState.remove(); await notification.remove(); };
}
