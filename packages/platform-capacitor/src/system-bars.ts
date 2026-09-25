import { StatusBar, Style } from '@capacitor/status-bar';
import { isCapacitorNative } from './notification-port';

let lastAppliedImmersive: boolean | null = null;
let systemBarQueue: Promise<void> = Promise.resolve();

export async function configureNativeSystemBars(): Promise<void> {
  await setNativeFocusImmersive(false);
}

/**
 * A shade/mini-window return is not a mode change. Android may leave our bar
 * state intact, so read it before sending window-mutating bridge calls again.
 * Serializing requests also prevents a slow initial show from overtaking hide.
 */
export function setNativeFocusImmersive(immersive: boolean, verifyVisibility = false): Promise<void> {
  if (!isCapacitorNative()) return Promise.resolve();
  const update = async () => {
    try {
      if (lastAppliedImmersive === immersive) {
        if (!verifyVisibility) return;
        const current = await StatusBar.getInfo();
        if (current.visible !== immersive) return;
      }
      await StatusBar.setOverlaysWebView({ overlay: true });
      if (immersive) {
        await StatusBar.hide();
      } else {
        await StatusBar.setStyle({ style: Style.Light });
        await StatusBar.setBackgroundColor({ color: '#F3F5F2' });
        await StatusBar.show();
      }
      lastAppliedImmersive = immersive;
    } catch {
      // Older Android WebViews can reject edge-to-edge controls; CSS safe areas remain active.
      // A later visibility transition may retry a failed native command.
      lastAppliedImmersive = null;
    }
  };
  const result = systemBarQueue.then(update, update);
  systemBarQueue = result;
  return result;
}
