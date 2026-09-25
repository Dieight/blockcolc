import { describe, expect, it } from 'vitest';
import { defaultFocusPreferences, FOCUS_PREFERENCES_KEY, loadFocusPreferences, parseFocusPreferences, saveFocusPreferences } from './focus-preferences';

describe('local focus preferences', () => {
  it('keeps real weather off for new and legacy records, persisting only explicit opt-in', () => {
    expect(defaultFocusPreferences().realWeatherEnabled).toBe(false);
    expect(parseFocusPreferences({ focusMinutes: 45, breakMinutes: 5 }).realWeatherEnabled).toBe(false);
    expect(parseFocusPreferences({ focusMinutes: 45, breakMinutes: 5, realWeatherEnabled: 'true' }).realWeatherEnabled).toBe(false);
    let saved = '';
    saveFocusPreferences({ setItem: (_key, value) => { saved = value; } }, { ...defaultFocusPreferences(), realWeatherEnabled: true });
    expect(loadFocusPreferences({ getItem: () => saved }).realWeatherEnabled).toBe(true);
  });
  it('requires explicit opt-in for automatically starting the next round', () => {
    expect(defaultFocusPreferences().autoContinueFocus).toBe(false);
    expect(parseFocusPreferences({ focusMinutes: 45, breakMinutes: 5 }).autoContinueFocus).toBe(false);
    expect(parseFocusPreferences({ focusMinutes: 45, breakMinutes: 5, autoContinueFocus: 'true' }).autoContinueFocus).toBe(false);
    let saved = '';
    saveFocusPreferences({ setItem: (_key, value) => { saved = value; } }, { ...defaultFocusPreferences(), autoContinueFocus: true });
    expect(loadFocusPreferences({ getItem: () => saved }).autoContinueFocus).toBe(true);
  });
  it('keeps minimal launch opt-in and persists only explicit true', () => {
    expect(parseFocusPreferences({ focusMinutes: 45, breakMinutes: 5 }).minimalMode).toBe(false);
    for (const minimalMode of ['true', 1, null]) {
      expect(parseFocusPreferences({ focusMinutes: 45, breakMinutes: 5, minimalMode }).minimalMode).toBe(false);
    }
    let saved = '';
    saveFocusPreferences({ setItem: (_key, value) => { saved = value; } }, { ...defaultFocusPreferences(), minimalMode: true });
    expect(loadFocusPreferences({ getItem: () => saved }).minimalMode).toBe(true);
  });
  it('distinguishes a new installation from a valid legacy record', () => {
    expect(parseFocusPreferences(null).showWorldCoordinates).toBe(false);
    expect(parseFocusPreferences({ focusMinutes: 25, breakMinutes: 0 })).toMatchObject({
      focusMinutes: 25, habitFocusMinutes: 25, breakMinutes: 0, showWorldCoordinates: true,
      focusGlassTransparency: 50, themeMode: 'system',
    });
  });
  it.each([null, [], 'invalid', { focusMinutes: '25', breakMinutes: 5 }, { focusMinutes: Infinity, breakMinutes: 5 }])('falls back for invalid root record %j', value => {
    expect(parseFocusPreferences(value)).toEqual(defaultFocusPreferences());
  });
  it('keeps the return-to-focus reminder enabled for legacy preference records', () => {
    expect(parseFocusPreferences({ focusMinutes: 45, breakMinutes: 5 }).returnToFocusReminders).toBe(true);
    expect(parseFocusPreferences({ focusMinutes: 45, breakMinutes: 5, returnToFocusReminders: false }).returnToFocusReminders).toBe(false);
  });
  it.each(['water', 'mist-beam'])('preserves the %s legacy visual mapping', visualExperiment => {
    expect(parseFocusPreferences({ focusMinutes: 45, breakMinutes: 5, visualExperiment }).lightingQuality).toBe('cinematic');
  });
  it('preserves valid options, explicit false and the zero glass endpoint', () => {
    const value = { ...defaultFocusPreferences(), themeMode: 'dark', lightingQuality: 'performance', constructionOutlineVisibility: 'off', focusGlassTransparency: 0 };
    expect(parseFocusPreferences(value)).toEqual(value);
  });
  it('rounds and clamps numeric boundaries without coercing malformed optional values to NaN', () => {
    expect(parseFocusPreferences({ focusMinutes: 999, breakMinutes: -1, habitFocusMinutes: 'bad', habitTargetRounds: {}, focusGlassTransparency: Infinity })).toMatchObject({
      focusMinutes: 180, breakMinutes: 0, habitFocusMinutes: 180, habitTargetRounds: 10, focusGlassTransparency: 50,
    });
    expect(parseFocusPreferences({ focusMinutes: 24.6, breakMinutes: 99, habitFocusMinutes: 0, habitTargetRounds: 100, focusGlassTransparency: 101 })).toMatchObject({
      focusMinutes: 25, breakMinutes: 60, habitFocusMinutes: 1, habitTargetRounds: 30, focusGlassTransparency: 100,
    });
  });
  it('loads corruption/denied storage safely without rewriting it', () => {
    expect(loadFocusPreferences({ getItem: () => '{' })).toEqual(defaultFocusPreferences());
    expect(loadFocusPreferences({ getItem: () => { throw new Error('denied'); } })).toEqual(defaultFocusPreferences());
  });
  it('round-trips the same storage key and exposes write failure instead of claiming persistence', () => {
    let saved = '';
    const value = { ...defaultFocusPreferences(), focusGlassTransparency: 100 };
    saveFocusPreferences({ setItem: (key, data) => { expect(key).toBe(FOCUS_PREFERENCES_KEY); saved = data; } }, value);
    expect(loadFocusPreferences({ getItem: () => saved })).toEqual(value);
    expect(() => saveFocusPreferences({ setItem: () => { throw new Error('quota'); } }, value)).toThrow('quota');
  });
});
