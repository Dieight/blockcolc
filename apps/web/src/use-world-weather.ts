import { useEffect, useRef, useState } from 'react';
import type { QWeatherAstronomyResult, QWeatherFailureReason, QWeatherLocationSource, QWeatherResult } from '@blockcolc/platform-capacitor';
import { localDateForDate, weatherForExternalOverride } from '@blockcolc/voxel/environment';
import type { AstronomyContext, AstronomySchedule } from '@blockcolc/voxel/astronomy';
import { qweatherVisual, type ExternalWeatherVisual } from './qweather-visual';

type NativeWeatherResult = QWeatherResult;

export interface WorldWeatherView {
  syncState: 'not_synced' | 'syncing' | 'available' | 'fallback';
  override: ExternalWeatherVisual | null;
  conditionText: string | null;
  attributions: string[];
  observedAt: string | null;
  locationSource: QWeatherLocationSource | null;
  source: 'local' | 'real';
  fallbackReason: QWeatherFailureReason | 'unknown_condition' | null;
  /** A provider-confirmed thunderstorm, never inferred from generic rain. */
  thunderstorm?: boolean;
  /** Renderer-owned perceptual projection shared with the glass overlay. */
  visualPrecipitationIntensity: number;
  /** Astronomy has its own request lifecycle and must survive weather failures. */
  astronomyContext: AstronomyContext | null;
  astronomySyncState: 'not_synced' | 'syncing' | 'calendar' | 'ephemeris_only' | 'unavailable';
  astronomyFailureReason: QWeatherFailureReason | null;
}

const LOCAL_WEATHER: WorldWeatherView = { syncState: 'not_synced', override: null, conditionText: null,
  attributions: [], observedAt: null, locationSource: null, source: 'local', fallbackReason: null,
  visualPrecipitationIntensity: 0, astronomyContext: null, astronomySyncState: 'not_synced', astronomyFailureReason: null };
const REFRESH_MS = 30 * 60_000;
const ERROR_RETRY_MS = 5 * 60_000;
const ASTRONOMY_REFRESH_MS = 12 * 60 * 60_000;
const MANUAL_RETRY_REASONS = new Set<QWeatherFailureReason>([
  'not_configured', 'location_permission_denied', 'permission_unavailable', 'signing_identity_unavailable',
  'native_plugin_unavailable', 'native_bridge_failed', 'native_result_invalid', 'authentication_failed', 'security_restriction',
  'invalid_host', 'quota_exhausted', 'billing_issue', 'account_suspended', 'api_deprecated', 'access_denied',
  'request_invalid', 'api_path_not_found', 'rate_limited', 'response_too_large',
  'unsupported_response_encoding', 'invalid_response', 'cache_clear_failed',
]);

export function shouldStartWorldWeatherRequest(
  enabled: boolean,
  worldVisible: boolean,
  documentVisible: boolean,
  permissionDenied: boolean,
): boolean {
  return enabled && worldVisible && documentVisible && !permissionDenied;
}

export function isWorldWeatherFailureRetryable(reason: QWeatherFailureReason | 'unknown_condition'): boolean {
  if (reason === 'unknown_condition') return false;
  return !MANUAL_RETRY_REASONS.has(reason);
}

export function shouldRefreshAstronomyCalendar(
  now: number,
  lastAttempt: number,
  lastSuccess: number,
  force = false,
  hasCoverage = true,
): boolean {
  if (force) return true;
  const delay = lastSuccess > 0 && hasCoverage ? ASTRONOMY_REFRESH_MS : ERROR_RETRY_MS;
  return now - lastAttempt >= delay;
}

/** A usable provider calendar must cover the current instant and the next 48
 * hours without a gap. Day intervals are half-open; event fields may be null. */
export function astronomyScheduleCovers48Hours(
  schedule: AstronomySchedule | null,
  nowMs: number,
): boolean {
  if (!schedule || !Number.isSafeInteger(nowMs) || schedule.days.length === 0 || schedule.days.length > 7) return false;
  let currentIndex = -1;
  let cursor = Number.NaN;
  for (let index = 0; index < schedule.days.length; index += 1) {
    const day = schedule.days[index];
    if (!Number.isSafeInteger(day.intervalStartMs) || !Number.isSafeInteger(day.intervalEndMs)
      || day.intervalStartMs >= day.intervalEndMs) return false;
    if (day.intervalStartMs <= nowMs && nowMs < day.intervalEndMs) {
      currentIndex = index;
      cursor = day.intervalEndMs;
      break;
    }
  }
  if (currentIndex < 0) return false;
  const requiredEnd = nowMs + 48 * 60 * 60_000;
  while (cursor < requiredEnd) {
    currentIndex += 1;
    const day = schedule.days[currentIndex];
    if (!day || day.intervalStartMs !== cursor || day.intervalEndMs <= cursor) return false;
    cursor = day.intervalEndMs;
  }
  return true;
}

async function requestCurrentWeather(shouldContinue: () => boolean, cacheClear: Promise<void> | null): Promise<NativeWeatherResult> {
  if (!shouldContinue()) return { status: 'unavailable', reason: 'request_cancelled' };
  if (cacheClear) await cacheClear;
  if (!shouldContinue()) return { status: 'unavailable', reason: 'request_cancelled' };
  let platform: typeof import('@blockcolc/platform-capacitor');
  try {
    platform = await import('@blockcolc/platform-capacitor');
  } catch {
    return { status: 'error', reason: 'native_plugin_unavailable' };
  }
  if (!shouldContinue()) return { status: 'unavailable', reason: 'request_cancelled' };
  if (!platform.isQWeatherAvailable()) return { status: 'unavailable', reason: 'unsupported_platform' };
  return await platform.getQWeatherCurrent();
}

async function requestAstronomy(shouldContinue: () => boolean, cacheClear: Promise<void> | null): Promise<QWeatherAstronomyResult> {
  if (!shouldContinue()) return { status: 'unavailable', reason: 'request_cancelled' };
  if (cacheClear) await cacheClear;
  if (!shouldContinue()) return { status: 'unavailable', reason: 'request_cancelled' };
  let platform: typeof import('@blockcolc/platform-capacitor');
  try {
    platform = await import('@blockcolc/platform-capacitor');
  } catch {
    return { status: 'error', reason: 'native_plugin_unavailable' };
  }
  if (!shouldContinue()) return { status: 'unavailable', reason: 'request_cancelled' };
  if (!platform.isQWeatherAvailable()) return { status: 'unavailable', reason: 'unsupported_platform' };
  return await platform.getQWeatherAstronomy();
}

async function cancelAstronomyRequest(): Promise<void> {
  try {
    const platform = await import('@blockcolc/platform-capacitor');
    if (platform.isQWeatherAvailable()) await platform.cancelQWeatherAstronomy();
  } catch {
    // A hidden route still drops its generation; an older native bridge may lack cancellation.
  }
}

async function clearCachedLocation(): Promise<boolean> {
  try {
    const platform = await import('@blockcolc/platform-capacitor');
    if (!platform.isQWeatherAvailable()) return true;
    return await platform.clearQWeatherLocationCache();
  } catch {
    // The request path is disabled even when an older native build lacks the cache method.
    return false;
  }
}

/** A pending bridge call may be reused only by the enabled interval that owns it. */
export function ownsWorldWeatherRequest(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration;
}

export function getOwnedWorldWeatherRequest<T>(
  pending: { generation: number; promise: T } | null,
  currentGeneration: number,
): { generation: number; promise: T } | null {
  return pending && ownsWorldWeatherRequest(pending.generation, currentGeneration) ? pending : null;
}

export function getVisibleWorldWeatherView(enabled: boolean, view: WorldWeatherView): WorldWeatherView {
  if (enabled) return view;
  return view.fallbackReason === 'cache_clear_failed'
    ? { ...LOCAL_WEATHER, syncState: 'fallback', fallbackReason: 'cache_clear_failed' }
    : LOCAL_WEATHER;
}

export function mergeWorldWeatherPreservingAstronomy(previous: WorldWeatherView, next: WorldWeatherView): WorldWeatherView {
  return {
    ...next,
    astronomyContext: previous.astronomyContext,
    astronomySyncState: previous.astronomySyncState,
    astronomyFailureReason: previous.astronomyFailureReason,
  };
}

export function mapQWeatherAstronomyContext(result: QWeatherAstronomyResult): AstronomyContext | null {
  if (result.status !== 'ok' && result.status !== 'ephemeris_only') return null;
  const schedule: AstronomySchedule | null = result.status === 'ok' ? {
    coordinates: result.coordinate,
    locationSource: result.locationSource,
    fetchedAtMs: result.fetchedAtMs,
    days: result.days,
    attribution: result.attributions,
  } : null;
  return { coordinates: result.coordinate, schedule, locationSource: result.locationSource };
}

/** Resident world hook: permission is requested only after explicit opt-in and
 * while the world is visible. A failed/stale reading has no renderer override. */
export function useWorldWeather(enabled: boolean, visible: boolean): WorldWeatherView {
  const [view, setView] = useState<WorldWeatherView>(LOCAL_WEATHER);
  const pending = useRef<{ generation: number; promise: Promise<NativeWeatherResult> } | null>(null);
  const requestGeneration = useRef(0);
  const astronomyPending = useRef<{ generation: number; promise: Promise<QWeatherAstronomyResult> } | null>(null);
  const astronomyGeneration = useRef(0);
  const astronomyWasVisible = useRef(false);
  const astronomyLastAttempt = useRef(Number.NEGATIVE_INFINITY);
  const astronomyLastSuccess = useRef(0);
  const astronomyScheduleRef = useRef<AstronomySchedule | null>(view.astronomyContext?.schedule ?? null);
  astronomyScheduleRef.current = view.astronomyContext?.schedule ?? null;
  const lastAttempt = useRef(Number.NEGATIVE_INFINITY);
  const lastSuccess = useRef(0);
  const permissionDenied = useRef(false);
  const manualRetryRequired = useRef(false);
  const disabledCacheClearStarted = useRef(false);
  const pendingCacheClear = useRef<Promise<void> | null>(null);
  const enabledState = useRef(enabled);
  enabledState.current = enabled;
  const visibleState = useRef(visible);
  visibleState.current = visible;

  useEffect(() => {
    if (!enabled) {
      // Disabling invalidates the previous owner before cache clearing can
      // cancel its native call. A quick re-enable must not adopt that promise.
      requestGeneration.current += 1;
      pending.current = null;
      lastAttempt.current = Number.NEGATIVE_INFINITY;
      lastSuccess.current = 0;
      permissionDenied.current = false;
      manualRetryRequired.current = false;
      if (!disabledCacheClearStarted.current) {
        disabledCacheClearStarted.current = true;
        pendingCacheClear.current = clearCachedLocation().then(cleared => {
          if (!cleared && !enabledState.current) {
            setView({ ...LOCAL_WEATHER, syncState: 'fallback', fallbackReason: 'cache_clear_failed' });
          }
        }).finally(() => {
          pendingCacheClear.current = null;
        });
      }
      setView(previous => mergeWorldWeatherPreservingAstronomy(previous, LOCAL_WEATHER));
      return;
    }
    disabledCacheClearStarted.current = false;
    if (!visible) {
      requestGeneration.current += 1;
      pending.current = null;
      return;
    }
    let alive = true;
    const refresh = async () => {
      if (!alive || !shouldStartWorldWeatherRequest(enabled, visible,
        document.visibilityState !== 'hidden', permissionDenied.current)) return;
      if (manualRetryRequired.current) return;
      const now = Date.now();
      // React StrictMode remounts effects. A request started by the first
      // effect must be adopted by the second, not throttled while its result
      // is discarded with the first effect's cleanup.
      const generation = requestGeneration.current;
      const ownedPending = getOwnedWorldWeatherRequest(pending.current, generation);
      if (!ownedPending && now - lastAttempt.current < (lastSuccess.current ? REFRESH_MS : ERROR_RETRY_MS)) return;
      // A pending request may be adopted by a new effect (for example React
      // StrictMode remount). Its validity belongs to current refs, not the
      // previous effect's `alive` flag.
      const canContinue = () => ownsWorldWeatherRequest(generation, requestGeneration.current)
        && shouldStartWorldWeatherRequest(enabledState.current, visibleState.current,
          document.visibilityState !== 'hidden', permissionDenied.current);
      const request = ownedPending ?? {
        generation,
        promise: requestCurrentWeather(canContinue, pendingCacheClear.current),
      };
      pending.current = request;
      setView(previous => ({ ...previous, syncState: 'syncing' }));
      const result = await request.promise;
      if (pending.current === request) pending.current = null;
      if (!alive || !ownsWorldWeatherRequest(request.generation, requestGeneration.current)) return;
      // Cancellation is an ownership/lifecycle signal, not a failed weather
      // attempt. Keep the local view and leave the next enabled tick eligible.
      if (result.status !== 'ok' && result.reason === 'request_cancelled') return;
      lastAttempt.current = Date.now();
      if (result.status !== 'ok') {
        if (result.status === 'permission_denied') permissionDenied.current = true;
        manualRetryRequired.current = !isWorldWeatherFailureRetryable(result.reason);
        lastSuccess.current = 0;
        setView(previous => mergeWorldWeatherPreservingAstronomy(previous, { ...LOCAL_WEATHER, syncState: 'fallback', fallbackReason: result.reason }));
        return;
      }
      const override = qweatherVisual(result.current);
      if (!override) {
        manualRetryRequired.current = true;
        lastSuccess.current = 0;
        setView(previous => mergeWorldWeatherPreservingAstronomy(previous, { ...LOCAL_WEATHER, syncState: 'fallback', fallbackReason: 'unknown_condition',
          attributions: result.attributions, observedAt: result.observedAt ?? null }));
        return;
      }
      manualRetryRequired.current = false;
      lastSuccess.current = Date.now();
      setView(previous => mergeWorldWeatherPreservingAstronomy(previous, { syncState: 'available', override, conditionText: result.current.conditionText,
        attributions: result.attributions, observedAt: result.observedAt ?? null,
        locationSource: result.locationSource ?? 'fresh',
        source: 'real', fallbackReason: null,
        visualPrecipitationIntensity: weatherForExternalOverride(localDateForDate(new Date()), override).visualPrecipitationIntensity,
        thunderstorm: override.thunderstorm === true,
        astronomyContext: previous.astronomyContext, astronomySyncState: previous.astronomySyncState,
        astronomyFailureReason: previous.astronomyFailureReason }));
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { alive = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [enabled, visible]);

  useEffect(() => {
    if (!enabled) {
      astronomyWasVisible.current = false;
      astronomyGeneration.current += 1;
      astronomyPending.current = null;
      astronomyLastAttempt.current = Number.NEGATIVE_INFINITY;
      astronomyLastSuccess.current = 0;
      setView(previous => ({ ...previous, astronomyContext: null,
        astronomySyncState: 'not_synced', astronomyFailureReason: null }));
      return;
    }
    if (!visible) {
      astronomyWasVisible.current = false;
      astronomyGeneration.current += 1;
      astronomyPending.current = null;
      void cancelAstronomyRequest();
      return;
    }
    let alive = true;
    const refresh = async (force = false) => {
      if (!alive || !shouldStartWorldWeatherRequest(enabled, visible,
        document.visibilityState !== 'hidden', permissionDenied.current)) return;
      const currentGeneration = astronomyGeneration.current;
      const currentPending = astronomyPending.current;
      if (currentPending && currentPending.generation === currentGeneration) {
        // StrictMode's second effect adopts the one native astronomy request.
      } else if (!shouldRefreshAstronomyCalendar(Date.now(), astronomyLastAttempt.current,
        astronomyLastSuccess.current, force,
        astronomyScheduleCovers48Hours(astronomyScheduleRef.current, Date.now()))) {
        return;
      }
      const canContinue = () => astronomyGeneration.current === currentGeneration
        && shouldStartWorldWeatherRequest(enabledState.current, visibleState.current,
          document.visibilityState !== 'hidden', permissionDenied.current);
      const request = currentPending?.generation === currentGeneration ? currentPending : {
        generation: currentGeneration,
        promise: requestAstronomy(canContinue, pendingCacheClear.current),
      };
      astronomyPending.current = request;
      setView(previous => ({ ...previous, astronomySyncState: 'syncing', astronomyFailureReason: null }));
      const result = await request.promise;
      if (astronomyPending.current === request) astronomyPending.current = null;
      if (!alive || astronomyGeneration.current !== request.generation) return;
      if (result.status === 'unavailable' && result.reason === 'request_cancelled') return;
      astronomyLastAttempt.current = Date.now();
      if (result.status === 'unavailable' && result.reason === 'location_permission_denied') {
        permissionDenied.current = true;
      }
      if (result.status === 'ok' || result.status === 'ephemeris_only') {
        const context = mapQWeatherAstronomyContext(result);
        astronomyLastSuccess.current = result.status === 'ok' ? Date.now() : 0;
        setView(previous => ({ ...previous, astronomyContext: context,
          astronomySyncState: result.status === 'ok' ? 'calendar' : 'ephemeris_only',
          astronomyFailureReason: result.status === 'ok' ? null : result.reason }));
        return;
      }
      astronomyLastSuccess.current = 0;
      setView(previous => ({ ...previous, astronomyContext: null,
        astronomySyncState: 'unavailable', astronomyFailureReason: result.reason }));
    };
    const resumedVisibility = !astronomyWasVisible.current;
    astronomyWasVisible.current = true;
    void refresh(resumedVisibility);
    const interval = window.setInterval(() => void refresh(), 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        astronomyGeneration.current += 1;
        astronomyPending.current = null;
        void cancelAstronomyRequest();
      } else {
        astronomyGeneration.current += 1;
        astronomyPending.current = null;
        void refresh(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { alive = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [enabled, visible]);

  return getVisibleWorldWeatherView(enabled, view);
}
