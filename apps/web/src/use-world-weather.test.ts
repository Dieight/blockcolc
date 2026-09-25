import { describe, expect, it } from 'vitest';
import {
  getOwnedWorldWeatherRequest,
  getVisibleWorldWeatherView,
  isWorldWeatherFailureRetryable,
  shouldStartWorldWeatherRequest,
  type WorldWeatherView,
} from './use-world-weather';

const localView: WorldWeatherView = {
  syncState: 'not_synced',
  override: null,
  conditionText: null,
  attributions: [],
  observedAt: null,
  locationSource: null,
  source: 'local',
  fallbackReason: null,
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
});
