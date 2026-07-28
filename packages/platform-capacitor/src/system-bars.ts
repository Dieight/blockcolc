import { StatusBar, Style } from '@capacitor/status-bar';
import { isCapacitorNative } from './notification-port';

export async function configureNativeSystemBars(): Promise<void> {
  await setNativeFocusImmersive(false);
}

export async function setNativeFocusImmersive(immersive: boolean): Promise<void> {
  if (!isCapacitorNative()) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    if (immersive) {
      await StatusBar.hide();
      return;
    }
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#F3F5F2' });
    await StatusBar.show();
  } catch {
    // Older Android WebViews can reject edge-to-edge controls; CSS safe areas remain active.
  }
}
