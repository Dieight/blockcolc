import { ApplicationService } from '@tomato-clock/application';
import { IndexedDbStateRepository } from '@tomato-clock/storage-indexeddb';
import { IndexedDbResourcePackRepository } from '@tomato-clock/resource-pack-indexeddb';
import { BrowserFocusLifecyclePort, BrowserNotificationPort, CryptoIdGenerator, DateClock } from './browser-adapters';
import { CapacitorFocusLifecyclePort, CapacitorNotificationPort, configureNativeSystemBars, isCapacitorNative } from '@tomato-clock/platform-capacitor';

export const APPLICATION_STATE_CHANGED_EVENT = 'blockcolc:application-state-changed';

export interface ApplicationStateChangedDetail {
  lifecycleType: 'background' | 'foreground';
  sessionId: string | null;
  excursionRecorded: boolean;
  effectiveExcursions: number | null;
  maxEffectiveExcursions: number;
}

export async function bootstrap() {
  await configureNativeSystemBars();
  const repository = new IndexedDbStateRepository({ databaseName: 'blockcolc-v1' });
  const service = await ApplicationService.initialize({ repository, backupRepository: repository, notifications: isCapacitorNative() ? new CapacitorNotificationPort() : new BrowserNotificationPort(), clock: new DateClock(), ids: new CryptoIdGenerator(), initialTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, initialRestWeekdays: [0, 6] });
  await service.resume();
  const lifecycle = isCapacitorNative() ? new CapacitorFocusLifecyclePort() : new BrowserFocusLifecyclePort();
  await lifecycle.subscribe(async event => {
    const before = service.snapshot().activeFocusSession;
    const result = await service.handleLifecycleEvent(event);
    const after = result.state.activeFocusSession;
    const beforeExcursions = before?.integrity.effectiveExcursions ?? null;
    const afterExcursions = after?.integrity.effectiveExcursions ?? null;
    const detail: ApplicationStateChangedDetail = {
      lifecycleType: event.type,
      sessionId: after?.id ?? before?.id ?? null,
      excursionRecorded: event.type === 'foreground'
        && beforeExcursions !== null
        && afterExcursions !== null
        && afterExcursions > beforeExcursions,
      effectiveExcursions: afterExcursions,
      maxEffectiveExcursions: result.state.focusIntegrityPolicy.maxEffectiveExcursions,
    };
    window.dispatchEvent(new CustomEvent<ApplicationStateChangedDetail>(APPLICATION_STATE_CHANGED_EVENT, { detail }));
  });
  return {
    service,
    resourcePacks: new IndexedDbResourcePackRepository({ databaseName: 'blockcolc-resource-packs-v1' }),
  };
}
