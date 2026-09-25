import { Capacitor, registerPlugin } from '@capacitor/core';

export type QWeatherPrecipitationType = 'rain' | 'snow' | 'ice' | 'mixed' | 'none' | 'unknown';

export interface QWeatherMeasurement {
  value: number;
  unit: string;
}

export interface QWeatherCurrent {
  conditionCode: string;
  conditionText: string;
  temperatureC?: number;
  cloudCover?: number;
  precipitationType: QWeatherPrecipitationType;
  precipitationIntensity?: QWeatherMeasurement;
  humidity?: number;
  windSpeed?: QWeatherMeasurement;
}

export type QWeatherFailureReason =
  | 'not_configured'
  | 'location_unavailable'
  | 'location_timeout'
  | 'location_permission_denied'
  | 'permission_unavailable'
  | 'request_cancelled'
  | 'cache_clear_failed'
  | 'native_plugin_unavailable'
  | 'native_bridge_failed'
  | 'native_result_invalid'
  | 'signing_identity_unavailable'
  | 'network_unavailable'
  | 'request_timeout'
  | 'request_failed'
  | 'authentication_failed'
  | 'security_restriction'
  | 'invalid_host'
  | 'quota_exhausted'
  | 'billing_issue'
  | 'account_suspended'
  | 'api_deprecated'
  | 'access_denied'
  | 'request_invalid'
  | 'api_path_not_found'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'response_too_large'
  | 'unsupported_response_encoding'
  | 'invalid_response'
  | 'unsupported_platform'
  | 'unknown';

export type QWeatherLocationSource = 'fresh' | 'cached';

export type QWeatherResult =
  | { status: 'ok'; current: QWeatherCurrent; observedAt?: string; locationSource?: QWeatherLocationSource; attributions: string[] }
  | { status: 'unavailable' | 'permission_denied' | 'error'; reason: QWeatherFailureReason };

interface QWeatherNativePlugin {
  getCurrentWeather(): Promise<unknown>;
  clearLocationCache(): Promise<unknown>;
}

const QWeatherNative = registerPlugin<QWeatherNativePlugin>('QWeatherNative');
const PRECIPITATION_TYPES = new Set<QWeatherPrecipitationType>(['rain', 'snow', 'ice', 'mixed', 'none', 'unknown']);
const FAILURE_REASONS = new Set<QWeatherFailureReason>([
  'not_configured',
  'location_unavailable',
  'location_timeout',
  'location_permission_denied',
  'permission_unavailable',
  'request_cancelled',
  'cache_clear_failed',
  'native_plugin_unavailable',
  'native_bridge_failed',
  'native_result_invalid',
  'signing_identity_unavailable',
  'network_unavailable',
  'request_timeout',
  'request_failed',
  'authentication_failed',
  'security_restriction',
  'invalid_host',
  'quota_exhausted',
  'billing_issue',
  'account_suspended',
  'api_deprecated',
  'access_denied',
  'request_invalid',
  'api_path_not_found',
  'rate_limited',
  'provider_unavailable',
  'response_too_large',
  'unsupported_response_encoding',
  'invalid_response',
  'unsupported_platform',
  'unknown',
]);

/** True when the native adapter is present on Android; credentials may still be unavailable. */
export function isQWeatherAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/** Read weather only when explicitly called. Native location permission is requested by this call. */
export async function getQWeatherCurrent(): Promise<QWeatherResult> {
  if (!isQWeatherAvailable()) return { status: 'unavailable', reason: 'unsupported_platform' };
  try {
    return normalizeQWeatherResult(await QWeatherNative.getCurrentWeather());
  } catch {
    // A bridge failure does not prove that an HTTP request reached QWeather.
    return { status: 'error', reason: 'native_bridge_failed' };
  }
}

/** Clear the app-private last-location cache when the user opts out. */
export async function clearQWeatherLocationCache(): Promise<boolean> {
  if (!isQWeatherAvailable()) return true;
  try {
    const result = asRecord(await QWeatherNative.clearLocationCache());
    return result?.status === 'ok';
  } catch {
    // The feature remains disabled even if an older native build cannot clear its cache.
    return false;
  }
}

/** Validate the small native DTO and ensure errors cannot smuggle credentials or response text. */
export function normalizeQWeatherResult(value: unknown): QWeatherResult {
  const result = asRecord(value);
  if (!result) return { status: 'error', reason: 'native_result_invalid' };
  if (result.status === 'unavailable' || result.status === 'permission_denied' || result.status === 'error') {
    const reason = typeof result.reason === 'string' && FAILURE_REASONS.has(result.reason as QWeatherFailureReason)
      ? result.reason as QWeatherFailureReason
      : 'native_result_invalid';
    return { status: result.status, reason };
  }
  if (result.status !== 'ok') return { status: 'error', reason: 'native_result_invalid' };

  const currentValue = asRecord(result.current);
  const conditionCode = boundedString(currentValue?.conditionCode, 16);
  const conditionText = boundedString(currentValue?.conditionText, 120);
  const rawCloudCover = currentValue?.cloudCover;
  const cloudCover = typeof rawCloudCover === 'number' && Number.isFinite(rawCloudCover)
    && rawCloudCover >= 0 && rawCloudCover <= 1 ? rawCloudCover : undefined;
  const precipitationType = currentValue?.precipitationType;
  if (!currentValue || !conditionCode || !conditionText
    || typeof precipitationType !== 'string' || !PRECIPITATION_TYPES.has(precipitationType as QWeatherPrecipitationType)) {
    return { status: 'error', reason: 'native_result_invalid' };
  }

  const attributions = normalizeAttributions(result.attributions);
  if (!attributions) return { status: 'error', reason: 'native_result_invalid' };

  const current: QWeatherCurrent = {
    conditionCode,
    conditionText,
    precipitationType: precipitationType as QWeatherPrecipitationType,
  };
  if (cloudCover !== undefined) current.cloudCover = cloudCover;
  if (isFiniteNumber(currentValue.temperatureC)) current.temperatureC = currentValue.temperatureC;
  const precipitationIntensity = normalizeMeasurement(currentValue.precipitationIntensity);
  if (precipitationIntensity) current.precipitationIntensity = precipitationIntensity;
  if (isFiniteNumber(currentValue.humidity) && currentValue.humidity >= 0 && currentValue.humidity <= 1) {
    current.humidity = currentValue.humidity;
  }
  const windSpeed = normalizeMeasurement(currentValue.windSpeed);
  if (windSpeed) current.windSpeed = windSpeed;

  const observedAt = boundedString(result.observedAt, 64);
  const locationSource = result.locationSource;
  if (locationSource !== undefined && locationSource !== 'fresh' && locationSource !== 'cached') {
    return { status: 'error', reason: 'native_result_invalid' };
  }
  return {
    status: 'ok',
    current,
    ...(observedAt ? { observedAt } : {}),
    ...(locationSource ? { locationSource } : {}),
    attributions,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maximumLength: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximumLength
    ? value.trim()
    : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeMeasurement(value: unknown): QWeatherMeasurement | undefined {
  const measurement = asRecord(value);
  const unit = boundedString(measurement?.unit, 16);
  if (!measurement || !unit || !isFiniteNumber(measurement.value) || measurement.value < 0) return undefined;
  return { value: measurement.value, unit };
}

function normalizeAttributions(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const attributions: string[] = [];
  for (const item of value.slice(0, 10)) {
    const attribution = boundedString(item, 2_048);
    if (attribution) attributions.push(attribution);
  }
  return attributions.length > 0 ? attributions : null;
}
