import { useEffect, useRef, useState } from 'react';
import type { QWeatherFailureReason, QWeatherLocationSource, QWeatherResult } from '@tomato-clock/platform-capacitor';
import { qweatherIsThunderstorm, qweatherVisual, type ExternalWeatherVisual } from './qweather-visual';

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
}

const LOCAL_WEATHER: WorldWeatherView = { syncState: 'not_synced', override: null, conditionText: null,
  attributions: [], observedAt: null, locationSource: null, source: 'local', fallbackReason: null };
const REFRESH_MS = 30 * 60_000;
const ERROR_RETRY_MS = 5 * 60_000;
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

async function requestCurrentWeather(shouldContinue: () => boolean, cacheClear: Promise<void> | null): Promise<NativeWeatherResult> {
  if (!shouldContinue()) return { status: 'unavailable', reason: 'request_cancelled' };
  if (cacheClear) await cacheClear;
  if (!shouldContinue()) return { status: 'unavailable', reason: 'request_cancelled' };
  let platform: typeof import('@tomato-clock/platform-capacitor');
  try {
    platform = await import('@tomato-clock/platform-capacitor');
  } catch {
    return { status: 'error', reason: 'native_plugin_unavailable' };
  }
  if (!shouldContinue()) return { status: 'unavailable', reason: 'request_cancelled' };
  if (!platform.isQWeatherAvailable()) return { status: 'unavailable', reason: 'unsupported_platform' };
  return await platform.getQWeatherCurrent();
}

async function clearCachedLocation(): Promise<boolean> {
  try {
    const platform = await import('@tomato-clock/platform-capacitor');
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

/** Resident world hook: permission is requested only after explicit opt-in and
 * while the world is visible. A failed/stale reading has no renderer override. */
export function useWorldWeather(enabled: boolean, visible: boolean): WorldWeatherView {
  const [view, setView] = useState<WorldWeatherView>(LOCAL_WEATHER);
  const pending = useRef<{ generation: number; promise: Promise<NativeWeatherResult> } | null>(null);
  const requestGeneration = useRef(0);
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
      setView(LOCAL_WEATHER);
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
        setView({ ...LOCAL_WEATHER, syncState: 'fallback', fallbackReason: result.reason });
        return;
      }
      const override = qweatherVisual(result.current);
      if (!override) {
        manualRetryRequired.current = true;
        lastSuccess.current = 0;
        setView({ ...LOCAL_WEATHER, syncState: 'fallback', fallbackReason: 'unknown_condition',
          attributions: result.attributions, observedAt: result.observedAt ?? null });
        return;
      }
      manualRetryRequired.current = false;
      lastSuccess.current = Date.now();
      setView({ syncState: 'available', override, conditionText: result.current.conditionText,
        attributions: result.attributions, observedAt: result.observedAt ?? null,
        locationSource: result.locationSource ?? 'fresh',
        source: 'real', fallbackReason: null,
        thunderstorm: override.kind === 'rain' && qweatherIsThunderstorm(result.current.conditionCode) });
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { alive = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [enabled, visible]);

  return getVisibleWorldWeatherView(enabled, view);
}
