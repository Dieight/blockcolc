import { ApplicationService } from '@tomato-clock/application';
import { IndexedDbStateRepository } from '@tomato-clock/storage-indexeddb';
import { IndexedDbResourcePackRepository } from '@tomato-clock/resource-pack-indexeddb';
import { BrowserFocusLifecyclePort, BrowserNotificationPort, CryptoIdGenerator, DateClock } from './browser-adapters';
import { CapacitorFocusLifecyclePort, CapacitorNotificationPort, configureNativeSystemBars, isCapacitorNative } from '@tomato-clock/platform-capacitor';

export const APPLICATION_STATE_CHANGED_EVENT = 'blockcolc:application-state-changed';

export async function bootstrap() {
  await configureNativeSystemBars();
  const repository = new IndexedDbStateRepository({ databaseName: 'blockcolc-v1' });
  const service = await ApplicationService.initialize({ repository, backupRepository: repository, notifications: isCapacitorNative() ? new CapacitorNotificationPort() : new BrowserNotificationPort(), clock: new DateClock(), ids: new CryptoIdGenerator(), initialTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, initialRestWeekdays: [0, 6] });
  await service.resume();
  const lifecycle = isCapacitorNative() ? new CapacitorFocusLifecyclePort() : new BrowserFocusLifecyclePort();
  await lifecycle.subscribe(async event => {
    await service.handleLifecycleEvent(event);
    window.dispatchEvent(new Event(APPLICATION_STATE_CHANGED_EVENT));
  });
  return {
    service,
    resourcePacks: new IndexedDbResourcePackRepository({ databaseName: 'blockcolc-resource-packs-v1' }),
  };
}
