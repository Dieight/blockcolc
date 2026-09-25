import { describe, expect, it } from 'vitest';
import { qweatherIsThunderstorm, qweatherVisual } from './qweather-visual';

describe('QWeather visual projection', () => {
  it('preserves distinct clear, cloud, rain, snow and fog visuals from documented codes', () => {
    expect(['100', '104', '305', '400', '499', '500', '512'].map(conditionCode => qweatherVisual({ conditionCode })?.kind))
      .toEqual(['clear', 'cloudy', 'rain', 'snow', 'snow', 'mist', 'mist']);
  });
  it('uses precipitation facts ahead of a stale generic condition and bounds intensity', () => {
    expect(qweatherVisual({ conditionCode: '104', precipitationType: 'snow', cloudCover: 1.5, precipitationIntensity: 50 }))
      .toEqual({ kind: 'snow', cloudIntensity: 1, precipitationIntensity: 1 });
    expect(qweatherVisual({ conditionCode: '300', precipitationIntensity: { value: 0.2, unit: 'in/h' } })?.precipitationIntensity).toBe(1);
    expect(qweatherVisual({ conditionCode: '300', precipitationIntensity: { value: 20, unit: 'unknown' } })?.precipitationIntensity).toBe(0.3);
    expect(qweatherVisual({ conditionCode: '100', precipitationType: 'none', cloudCover: -1 })?.cloudIntensity).toBe(0);
  });
  it('returns local fallback for future/unknown provider codes', () => {
    expect(qweatherVisual({ conditionCode: '999', precipitationType: 'unknown' })).toBeNull();
  });
  it('distinguishes provider-confirmed thunderstorms from ordinary showers', () => {
    expect(['302', '303', '304'].map(qweatherIsThunderstorm)).toEqual([true, true, true]);
    expect(['300', '301', '305', '400', '999'].some(qweatherIsThunderstorm)).toBe(false);
  });
});
