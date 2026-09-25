import { describe, expect, it } from 'vitest';
import { normalizeQWeatherResult } from '../src/qweather';

describe('QWeather native result boundary', () => {
  it('preserves the provider attribution and typed current weather values', () => {
    expect(normalizeQWeatherResult({
      status: 'ok',
      current: {
        conditionCode: '305',
        conditionText: '小雨',
        temperatureC: 21.4,
        cloudCover: 0.72,
        precipitationType: 'rain',
        precipitationIntensity: { value: 0.8, unit: 'mm/h' },
        humidity: 0.61,
        windSpeed: { value: 2.4, unit: 'm/s' },
      },
      observedAt: '2026-09-23T04:00Z',
      attributions: ['https://developer.qweather.com/attribution.html'],
    })).toEqual({
      status: 'ok',
      current: {
        conditionCode: '305',
        conditionText: '小雨',
        temperatureC: 21.4,
        cloudCover: 0.72,
        precipitationType: 'rain',
        precipitationIntensity: { value: 0.8, unit: 'mm/h' },
        humidity: 0.61,
        windSpeed: { value: 2.4, unit: 'm/s' },
      },
      observedAt: '2026-09-23T04:00Z',
      attributions: ['https://developer.qweather.com/attribution.html'],
    });
  });

  it('keeps optional readings optional while requiring condition and attribution', () => {
    expect(normalizeQWeatherResult({
      status: 'ok',
      current: { conditionCode: '100', conditionText: '晴', cloudCover: 0, precipitationType: 'none' },
      attributions: ['QWeather attribution'],
    })).toMatchObject({ status: 'ok', current: { conditionCode: '100', cloudCover: 0, precipitationType: 'none' } });

    expect(normalizeQWeatherResult({
      status: 'ok',
      current: { conditionCode: '100', conditionText: '晴', precipitationType: 'none' },
      attributions: ['QWeather attribution'],
    })).toEqual({
      status: 'ok',
      current: { conditionCode: '100', conditionText: '晴', precipitationType: 'none' },
      attributions: ['QWeather attribution'],
    });

    expect(normalizeQWeatherResult({
      status: 'ok',
      current: { conditionCode: '100', conditionText: '晴', cloudCover: 2, precipitationType: 'none' },
      attributions: ['QWeather attribution'],
    })).toEqual({
      status: 'ok',
      current: { conditionCode: '100', conditionText: '晴', precipitationType: 'none' },
      attributions: ['QWeather attribution'],
    });

    expect(normalizeQWeatherResult({
      status: 'ok',
      current: { conditionCode: '100', conditionText: '晴', precipitationType: 'none' },
      attributions: [],
    })).toEqual({ status: 'error', reason: 'native_result_invalid' });
    expect(normalizeQWeatherResult({
      status: 'ok',
      current: { conditionCode: '100', precipitationType: 'none' },
      attributions: ['QWeather attribution'],
    })).toEqual({ status: 'error', reason: 'native_result_invalid' });
  });

  it('rejects unsupported precipitation types', () => {
    expect(normalizeQWeatherResult({
      status: 'ok',
      current: {
        conditionCode: '100', conditionText: '晴', cloudCover: 0.5, precipitationType: 'hail',
      },
      attributions: ['QWeather attribution'],
    })).toEqual({ status: 'error', reason: 'native_result_invalid' });
  });

  it('distinguishes malformed native DTOs from a native provider-payload parse failure', () => {
    for (const malformed of [
      null,
      {},
      { status: 'pending' },
      { status: 'error', reason: 'unrecognized native reason' },
      { status: 'ok', current: {}, attributions: ['QWeather attribution'] },
      { status: 'ok', current: { conditionCode: '100', conditionText: '晴', precipitationType: 'none' }, attributions: 'not-an-array' },
    ]) {
      expect(normalizeQWeatherResult(malformed)).toEqual({ status: 'error', reason: 'native_result_invalid' });
    }
    expect(normalizeQWeatherResult({ status: 'error', reason: 'invalid_response' }))
      .toEqual({ status: 'error', reason: 'invalid_response' });
  });

  it('returns only allowlisted failure reasons', () => {
    expect(normalizeQWeatherResult({ status: 'permission_denied', reason: 'location_permission_denied' }))
      .toEqual({ status: 'permission_denied', reason: 'location_permission_denied' });
    expect(normalizeQWeatherResult({ status: 'error', reason: 'request_failed' }))
      .toEqual({ status: 'error', reason: 'request_failed' });
    expect(normalizeQWeatherResult({ status: 'error', reason: 'invalid_response' }))
      .toEqual({ status: 'error', reason: 'invalid_response' });
    expect(normalizeQWeatherResult({ status: 'error', reason: 'security_restriction' }))
      .toEqual({ status: 'error', reason: 'security_restriction' });
    expect(normalizeQWeatherResult({ status: 'error', reason: 'native_bridge_failed' }))
      .toEqual({ status: 'error', reason: 'native_bridge_failed' });
    expect(normalizeQWeatherResult({ status: 'error', reason: 'sensitive details from an exception' }))
      .toEqual({ status: 'error', reason: 'native_result_invalid' });
  });

  it('retains only a safe fresh-or-cached location marker', () => {
    const result = {
      status: 'ok',
      current: { conditionCode: '100', conditionText: '晴', precipitationType: 'none' },
      attributions: ['QWeather attribution'],
      locationSource: 'cached',
      coordinates: '39.92,116.41',
    };
    expect(normalizeQWeatherResult(result)).toEqual({
      status: 'ok',
      current: { conditionCode: '100', conditionText: '晴', precipitationType: 'none' },
      attributions: ['QWeather attribution'],
      locationSource: 'cached',
    });
    expect(normalizeQWeatherResult({ ...result, locationSource: 'raw coordinates' }))
      .toEqual({ status: 'error', reason: 'native_result_invalid' });
  });
});
