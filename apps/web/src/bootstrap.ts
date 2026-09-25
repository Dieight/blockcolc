import { ApplicationService } from '@tomato-clock/application';
import { attachFocusExport } from './focus-export-coordinator';
import { IndexedDbStateRepository } from '@tomato-clock/storage-indexeddb';
import { IndexedDbResourcePackRepository } from '@tomato-clock/resource-pack-indexeddb';
import { BrowserFocusLifecyclePort, BrowserNotificationPort, CryptoIdGenerator, DateClock } from './browser-adapters';
import { CapacitorFocusLifecyclePort, CapacitorNotificationPort, configureNativeSystemBars, isCapacitorNative } from '@tomato-clock/platform-capacitor';

import { APPLICATION_STATE_CHANGED_EVENT, shouldPublishLifecycleRefresh, type ApplicationStateChangedDetail } from './application-lifecycle';
import { registerBuiltinDailyRewardBlueprints } from './builtin-daily-rewards';
export { APPLICATION_STATE_CHANGED_EVENT, type ApplicationStateChangedDetail } from './application-lifecycle';

export async function bootstrap() {
  await configureNativeSystemBars();
  const repository = new IndexedDbStateRepository({ databaseName: 'blockcolc-v1' });
  const service = await ApplicationService.initialize({ repository, backupRepository: repository, notifications: isCapacitorNative() ? new CapacitorNotificationPort() : new BrowserNotificationPort(), clock: new DateClock(), ids: new CryptoIdGenerator(), initialTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, initialRestWeekdays: [0, 6] });
  await service.resume();
  // The supplemental bundle is optional in clean/public builds. A failed
  // bundle load or invalid optional asset must not prevent the local clock from
  // opening; the domain command remains the persistence/validation boundary.
  try {
    const { BUILTIN_DAILY_REWARD_BLUEPRINTS } = await import('@tomato-clock/voxel');
    await registerBuiltinDailyRewardBlueprints(service, BUILTIN_DAILY_REWARD_BLUEPRINTS);
  } catch {
    // Optional packaged decorations are an enhancement, never a bootstrap gate.
  }
  if (isCapacitorNative()) attachFocusExport(service);
  const lifecycle = isCapacitorNative() ? new CapacitorFocusLifecyclePort() : new BrowserFocusLifecyclePort();
  await lifecycle.subscribe(async event => {
    const beforeRevision = service.stateRevision();
    const before = service.snapshot().activeFocusSession;
    const result = await service.handleLifecycleEvent(event);
    const after = result.state.activeFocusSession;
    const beforeExcursions = before?.integrity.effectiveExcursions ?? null;
    const afterExcursions = after?.integrity.effectiveExcursions ?? null;
    const activeFactsChanged = before?.id !== after?.id
      || before?.endsAt !== after?.endsAt
      || before?.integrity.backgroundedAt !== after?.integrity.backgroundedAt
      || before?.integrity.backgroundReason !== after?.integrity.backgroundReason
      || before?.integrity.effectiveExcursions !== after?.integrity.effectiveExcursions;
    // A duplicate native callback can resolve successfully without changing
    // either the aggregate or its active-session lifecycle facts. Do not emit
    // another receipt/refresh in that case; it needlessly wakes the world and
    // renderer while the notification shade is closing.
    if (!shouldPublishLifecycleRefresh({ lifecycleType: event.type, ok: result.ok, events: result.ok ? result.events : [], activeFactsChanged, revisionChanged: service.stateRevision() !== beforeRevision })) return;
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
