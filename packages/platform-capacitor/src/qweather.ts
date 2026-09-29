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

export type QWeatherMoonPhase =
  | 'new-moon' | 'waxing-crescent' | 'first-quarter' | 'waxing-gibbous'
  | 'full-moon' | 'waning-gibbous' | 'last-quarter' | 'waning-crescent';

export interface QWeatherAstronomyDay {
  intervalStartMs: number;
  intervalEndMs: number;
  solar: {
    astronomicalDawnMs: number | null;
    nauticalDawnMs: number | null;
    civilDawnMs: number | null;
    sunriseMs: number | null;
    solarNoonMs: number | null;
    sunsetMs: number | null;
    civilDuskMs: number | null;
    nauticalDuskMs: number | null;
    astronomicalDuskMs: number | null;
    solarMidnightMs: number | null;
  };
  lunar: {
    moonriseMs: number | null;
    moonsetMs: number | null;
    moonTransitMs: number | null;
    moonUnderfootMs: number | null;
    phase: QWeatherMoonPhase | null;
  };
}

export interface QWeatherAstronomySchedule {
  coordinate: { latitude: number; longitude: number };
  locationSource: QWeatherLocationSource;
  fetchedAtMs: number;
  days: QWeatherAstronomyDay[];
  attributions: string[];
}

export type QWeatherAstronomyResult =
  | ({ status: 'ok' } & QWeatherAstronomySchedule)
  | { status: 'ephemeris_only'; reason: QWeatherFailureReason; coordinate: { latitude: number; longitude: number }; locationSource: QWeatherLocationSource; fetchedAtMs: number }
  | { status: 'unavailable' | 'error'; reason: QWeatherFailureReason };

export type QWeatherResult =
  | { status: 'ok'; current: QWeatherCurrent; observedAt?: string; locationSource?: QWeatherLocationSource; attributions: string[] }
  | { status: 'unavailable' | 'permission_denied' | 'error'; reason: QWeatherFailureReason };

interface QWeatherNativePlugin {
  getCurrentWeather(): Promise<unknown>;
  getAstronomy(): Promise<unknown>;
  cancelAstronomy(): Promise<unknown>;
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

/** Fetch the bounded event calendar independently from current weather. */
export async function getQWeatherAstronomy(): Promise<QWeatherAstronomyResult> {
  if (!isQWeatherAvailable()) return { status: 'unavailable', reason: 'unsupported_platform' };
  try {
    return normalizeQWeatherAstronomyResult(await QWeatherNative.getAstronomy());
  } catch {
    return { status: 'error', reason: 'native_bridge_failed' };
  }
}

/** Cancel only the astronomy generation; current weather and shared location work remain valid. */
export async function cancelQWeatherAstronomy(): Promise<boolean> {
  if (!isQWeatherAvailable()) return true;
  try {
    const result = asRecord(await QWeatherNative.cancelAstronomy());
    return result?.status === 'ok';
  } catch {
    return false;
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

/** Validate finite, bounded astronomy DTOs without retaining any raw provider fields. */
export function normalizeQWeatherAstronomyResult(value: unknown): QWeatherAstronomyResult {
  const result = asRecord(value);
  if (!result) return { status: 'error', reason: 'native_result_invalid' };
  if (result.status === 'unavailable' || result.status === 'error') {
    const reason = typeof result.reason === 'string' && FAILURE_REASONS.has(result.reason as QWeatherFailureReason)
      ? result.reason as QWeatherFailureReason : 'native_result_invalid';
    return { status: result.status, reason };
  }
  const coordinate = normalizeCoordinate(result.coordinate);
  const locationSource = result.locationSource;
  const fetchedAtMs = result.fetchedAtMs;
  if (!coordinate || (locationSource !== 'fresh' && locationSource !== 'cached')
    || !isEpoch(fetchedAtMs)) {
    return { status: 'error', reason: 'native_result_invalid' };
  }
  if (result.status === 'ephemeris_only') {
    const reason = typeof result.reason === 'string' && FAILURE_REASONS.has(result.reason as QWeatherFailureReason)
      ? result.reason as QWeatherFailureReason : 'native_result_invalid';
    return { status: 'ephemeris_only', reason, coordinate, locationSource, fetchedAtMs };
  }
  if (result.status !== 'ok') return { status: 'error', reason: 'native_result_invalid' };
  const rawDays = result.days;
  const attributions = normalizeAttributions(result.attributions);
  if (!Array.isArray(rawDays) || rawDays.length === 0 || rawDays.length > 7 || !attributions) {
    return { status: 'error', reason: 'native_result_invalid' };
  }
  const days: QWeatherAstronomyDay[] = [];
  for (const rawDay of rawDays) {
    const day = normalizeAstronomyDay(rawDay);
    if (!day) return { status: 'error', reason: 'native_result_invalid' };
    days.push(day);
  }
  days.sort((left, right) => left.intervalStartMs - right.intervalStartMs);
  for (let index = 1; index < days.length; index += 1) {
    const previous = days[index - 1];
    const current = days[index];
    if (!previous || !current || previous.intervalEndMs > current.intervalStartMs) {
      return { status: 'error', reason: 'native_result_invalid' };
    }
  }
  return { status: 'ok', coordinate, locationSource, fetchedAtMs, days, attributions };
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

const SOLAR_FIELDS = [
  'astronomicalDawnMs', 'nauticalDawnMs', 'civilDawnMs', 'sunriseMs', 'solarNoonMs',
  'sunsetMs', 'civilDuskMs', 'nauticalDuskMs', 'astronomicalDuskMs', 'solarMidnightMs',
] as const;
const LUNAR_FIELDS = ['moonriseMs', 'moonsetMs', 'moonTransitMs', 'moonUnderfootMs'] as const;
const MOON_PHASES = new Set<QWeatherMoonPhase>([
  'new-moon', 'waxing-crescent', 'first-quarter', 'waxing-gibbous',
  'full-moon', 'waning-gibbous', 'last-quarter', 'waning-crescent',
]);

function normalizeCoordinate(value: unknown): { latitude: number; longitude: number } | null {
  const coordinate = asRecord(value);
  if (!isFiniteNumber(coordinate?.latitude) || !isFiniteNumber(coordinate?.longitude)
    || coordinate.latitude < -90 || coordinate.latitude > 90
    || coordinate.longitude < -180 || coordinate.longitude > 180) return null;
  return { latitude: coordinate.latitude, longitude: coordinate.longitude };
}

function normalizeAstronomyDay(value: unknown): QWeatherAstronomyDay | null {
  const day = asRecord(value);
  if (!day || !isEpoch(day.intervalStartMs) || !isEpoch(day.intervalEndMs)
    || day.intervalStartMs < 0 || day.intervalEndMs <= day.intervalStartMs
    || day.intervalEndMs - day.intervalStartMs > 48 * 60 * 60_000) return null;
  const solarValue = asRecord(day.solar);
  const lunarValue = asRecord(day.lunar);
  if (!solarValue || !lunarValue) return null;
  const solar: QWeatherAstronomyDay['solar'] = {} as QWeatherAstronomyDay['solar'];
  for (const field of SOLAR_FIELDS) {
    const event = solarValue[field];
    if (event !== null && !isEpoch(event)) return null;
    solar[field] = event as number | null;
  }
  const lunar: QWeatherAstronomyDay['lunar'] = {} as QWeatherAstronomyDay['lunar'];
  for (const field of LUNAR_FIELDS) {
    const event = lunarValue[field];
    if (event !== null && !isEpoch(event)) return null;
    lunar[field] = event as number | null;
  }
  const phase = lunarValue.phase;
  if (phase !== null && (typeof phase !== 'string' || !MOON_PHASES.has(phase as QWeatherMoonPhase))) return null;
  lunar.phase = phase as QWeatherMoonPhase | null;
  return { intervalStartMs: day.intervalStartMs, intervalEndMs: day.intervalEndMs, solar, lunar };
}

function isEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
