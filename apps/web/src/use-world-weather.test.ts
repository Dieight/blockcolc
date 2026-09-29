import { describe, expect, it } from 'vitest';
import {
  getOwnedWorldWeatherRequest,
  getVisibleWorldWeatherView,
  isWorldWeatherFailureRetryable,
  astronomyScheduleCovers48Hours,
  mapQWeatherAstronomyContext,
  mergeWorldWeatherPreservingAstronomy,
  shouldRefreshAstronomyCalendar,
  shouldStartWorldWeatherRequest,
  type WorldWeatherView,
} from './use-world-weather';
import type { AstronomySchedule } from '@blockcolc/voxel';

const localView: WorldWeatherView = {
  syncState: 'not_synced',
  override: null,
  conditionText: null,
  attributions: [],
  observedAt: null,
  locationSource: null,
  source: 'local',
  fallbackReason: null,
  visualPrecipitationIntensity: 0,
  astronomyContext: null,
  astronomySyncState: 'not_synced',
  astronomyFailureReason: null,
};

describe('world weather request gate', () => {
  it('starts requests only while enabled, on the visible world route and with a visible document', () => {
    expect(shouldStartWorldWeatherRequest(true, true, true, false)).toBe(true);
    expect(shouldStartWorldWeatherRequest(false, true, true, false)).toBe(false);
    expect(shouldStartWorldWeatherRequest(true, false, true, false)).toBe(false);
    expect(shouldStartWorldWeatherRequest(true, true, false, false)).toBe(false);
    expect(shouldStartWorldWeatherRequest(true, true, true, true)).toBe(false);
  });

  it('does not automatically retry configuration, permission, bridge, parse or authorization failures', () => {
    for (const reason of [
      'not_configured', 'location_permission_denied', 'native_plugin_unavailable',
      'native_bridge_failed', 'native_result_invalid', 'invalid_response', 'security_restriction', 'rate_limited',
    ] as const) {
      expect(isWorldWeatherFailureRetryable(reason), reason).toBe(false);
    }
    expect(isWorldWeatherFailureRetryable('network_unavailable')).toBe(true);
    expect(isWorldWeatherFailureRetryable('request_timeout')).toBe(true);
    expect(isWorldWeatherFailureRetryable('provider_unavailable')).toBe(true);
    expect(isWorldWeatherFailureRetryable('request_cancelled')).toBe(true);
  });

  it('does not reuse a cancelled request after disable then quick re-enable', () => {
    const oldPending = { generation: 12, promise: Promise.resolve('cancelled') };
    const generationAfterDisable = 13;
    expect(getOwnedWorldWeatherRequest(oldPending, generationAfterDisable)).toBeNull();

    const reopenedRequest = { generation: generationAfterDisable, promise: Promise.resolve('fresh') };
    expect(getOwnedWorldWeatherRequest(oldPending, generationAfterDisable)).toBeNull();
    expect(getOwnedWorldWeatherRequest(reopenedRequest, generationAfterDisable)).toBe(reopenedRequest);
  });

  it('keeps cache-clear failure visible while weather remains disabled', () => {
    expect(getVisibleWorldWeatherView(false, localView)).toEqual(localView);
    expect(getVisibleWorldWeatherView(false, { ...localView,
      syncState: 'fallback', fallbackReason: 'cache_clear_failed' })).toMatchObject({
      source: 'local', syncState: 'fallback', fallbackReason: 'cache_clear_failed',
    });
  });

  it('backs off a failed astronomy calendar for five minutes and refreshes a valid one after twelve hours', () => {
    const fiveMinutes = 5 * 60_000;
    const twelveHours = 12 * 60 * 60_000;
    expect(shouldRefreshAstronomyCalendar(10_000, 10_000, 0)).toBe(false);
    expect(shouldRefreshAstronomyCalendar(10_000 + fiveMinutes - 1, 10_000, 0)).toBe(false);
    expect(shouldRefreshAstronomyCalendar(10_000 + fiveMinutes, 10_000, 0)).toBe(true);
    expect(shouldRefreshAstronomyCalendar(10_000 + twelveHours - 1, 10_000, 10_000)).toBe(false);
    expect(shouldRefreshAstronomyCalendar(10_000 + twelveHours, 10_000, 10_000)).toBe(true);
    expect(shouldRefreshAstronomyCalendar(10_001, 10_000, 10_000, true)).toBe(true);
  });

  it('refreshes successful calendars whose intervals do not continuously cover the next 48 hours', () => {
    const now = Date.UTC(2026, 0, 1, 12);
    const day = (start: number, end: number) => ({
      intervalStartMs: start, intervalEndMs: end,
      solar: { astronomicalDawnMs: null, nauticalDawnMs: null, civilDawnMs: null, sunriseMs: null,
        solarNoonMs: null, sunsetMs: null, civilDuskMs: null, nauticalDuskMs: null,
        astronomicalDuskMs: null, solarMidnightMs: null },
      lunar: { moonriseMs: null, moonsetMs: null, moonTransitMs: null, moonUnderfootMs: null, phase: null },
    });
    const schedule = (intervals: Array<[number, number]>): AstronomySchedule => ({
      coordinates: { latitude: 0, longitude: 0 }, locationSource: 'fresh', fetchedAtMs: now,
      days: intervals.map(([start, end]) => day(start, end)), attribution: [],
    });
    const hour = 60 * 60_000;
    const continuous = schedule([[now - hour, now + 12 * hour], [now + 12 * hour, now + 36 * hour], [now + 36 * hour, now + 60 * hour]]);
    expect(astronomyScheduleCovers48Hours(continuous, now)).toBe(true);
    expect(shouldRefreshAstronomyCalendar(now + hour, now, now, false,
      astronomyScheduleCovers48Hours(continuous, now + hour))).toBe(false);
    expect(astronomyScheduleCovers48Hours(schedule([[now + hour, now + 72 * hour]]), now)).toBe(false);
    expect(astronomyScheduleCovers48Hours(schedule([[now - hour, now + 24 * hour], [now + 25 * hour, now + 72 * hour]]), now)).toBe(false);
    const gapCoverage = astronomyScheduleCovers48Hours(
      schedule([[now - hour, now + 24 * hour], [now + 25 * hour, now + 72 * hour]]), now + hour);
    expect(gapCoverage).toBe(false);
    expect(shouldRefreshAstronomyCalendar(now + 4 * 60_000, now, now, false, gapCoverage)).toBe(false);
    expect(shouldRefreshAstronomyCalendar(now + 5 * 60_000, now, now, false, gapCoverage)).toBe(true);
    expect(astronomyScheduleCovers48Hours(schedule([[now - hour, now + 24 * hour], [now + 24 * hour, now + 72 * hour]]), now)).toBe(true);
    expect(astronomyScheduleCovers48Hours(schedule([[now - 49 * hour, now - hour], [now + hour, now + 72 * hour]]), now)).toBe(false);
    expect(shouldRefreshAstronomyCalendar(now + 4 * 60_000, now, 0, false, false)).toBe(false);
  });

  it('maps ephemeris-only to an authorized coordinate without claiming a calendar', () => {
    const context = mapQWeatherAstronomyContext({
      status: 'ephemeris_only', reason: 'network_unavailable', coordinate: { latitude: 39.92, longitude: 116.41 },
      locationSource: 'cached', fetchedAtMs: 1_800_000_000_000,
    });
    expect(context).toEqual({
      coordinates: { latitude: 39.92, longitude: 116.41 }, schedule: null, locationSource: 'cached',
    });
  });

  it('keeps independent astronomy data when weather returns to local fallback', () => {
    const context = {
      coordinates: { latitude: 39.92, longitude: 116.41 }, schedule: null, locationSource: 'fresh' as const,
    };
    const previous = { ...localView, astronomyContext: context,
      astronomySyncState: 'ephemeris_only' as const, astronomyFailureReason: 'network_unavailable' as const };
    const next = mergeWorldWeatherPreservingAstronomy(previous, {
      ...localView, syncState: 'fallback', fallbackReason: 'request_failed',
    });
    expect(next.syncState).toBe('fallback');
    expect(next.astronomySyncState).toBe('ephemeris_only');
    expect(next.astronomyContext).toBe(context);
    expect(next.astronomyFailureReason).toBe('network_unavailable');
  });
});
