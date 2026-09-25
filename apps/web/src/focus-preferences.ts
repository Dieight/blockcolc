import type { FocusPreferences } from './app-types';

export const FOCUS_PREFERENCES_KEY = 'blockcolc-focus-preferences-v1';

export function defaultFocusPreferences(): FocusPreferences {
  return {
    focusMinutes: 45, habitFocusMinutes: 45, habitTargetRounds: 10, breakMinutes: 5,
    lightingQuality: 'auto', constructionOutlineVisibility: 'current',
    showWorldCoordinates: false, focusGlassTransparency: 50, themeMode: 'system',
    returnToFocusReminders: true,
    autoContinueFocus: false,
    realWeatherEnabled: false,
    minimalMode: false,
  };
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value))) : fallback;
}

/** Local presentation preferences only; never part of the domain/backup schema. */
export function parseFocusPreferences(input: unknown): FocusPreferences {
  const defaults = defaultFocusPreferences();
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return defaults;
  const value = input as Record<string, unknown>;
  // Preserve the existing legacy-record boundary and migration defaults.
  if (typeof value.focusMinutes !== 'number' || !Number.isFinite(value.focusMinutes)
    || typeof value.breakMinutes !== 'number' || !Number.isFinite(value.breakMinutes)) return defaults;
  const focusMinutes = integer(value.focusMinutes, defaults.focusMinutes, 1, 180);
  return {
    focusMinutes,
    habitFocusMinutes: integer(value.habitFocusMinutes, focusMinutes, 1, 180),
    habitTargetRounds: integer(value.habitTargetRounds, defaults.habitTargetRounds, 10, 30),
    breakMinutes: integer(value.breakMinutes, defaults.breakMinutes, 0, 60),
    lightingQuality: value.lightingQuality === 'performance' || value.lightingQuality === 'balanced'
      || value.lightingQuality === 'cinematic' || value.lightingQuality === 'auto'
      ? value.lightingQuality : value.visualExperiment === 'water' || value.visualExperiment === 'mist-beam' ? 'cinematic' : 'auto',
    constructionOutlineVisibility: value.constructionOutlineVisibility === 'off'
      || value.constructionOutlineVisibility === 'all' || value.constructionOutlineVisibility === 'current'
      ? value.constructionOutlineVisibility : 'current',
    showWorldCoordinates: typeof value.showWorldCoordinates === 'boolean' ? value.showWorldCoordinates : true,
    focusGlassTransparency: integer(value.focusGlassTransparency, defaults.focusGlassTransparency, 0, 100),
    themeMode: value.themeMode === 'light' || value.themeMode === 'dark' ? value.themeMode : 'system',
    returnToFocusReminders: typeof value.returnToFocusReminders === 'boolean' ? value.returnToFocusReminders : defaults.returnToFocusReminders,
    autoContinueFocus: value.autoContinueFocus === true,
    realWeatherEnabled: value.realWeatherEnabled === true,
    minimalMode: value.minimalMode === true,
  };
}

export function loadFocusPreferences(storage: Pick<Storage, 'getItem'>): FocusPreferences {
  try { return parseFocusPreferences(JSON.parse(storage.getItem(FOCUS_PREFERENCES_KEY) ?? 'null')); }
  catch { return defaultFocusPreferences(); }
}

export function saveFocusPreferences(storage: Pick<Storage, 'setItem'>, value: FocusPreferences): void {
  storage.setItem(FOCUS_PREFERENCES_KEY, JSON.stringify(value));
}
