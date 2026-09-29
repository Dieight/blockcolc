import type { ExternalWeatherVisualOverride } from '@blockcolc/voxel';

/** Session-only presentation controls. Never serialize these with preferences or backups. */
export interface WorldDebugSettings {
  enabled: boolean;
  weather: 'normal' | 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'mist';
  timeMinutes: number | null;
  decayAmount: number | null;
}

export const NORMAL_WORLD_DEBUG: WorldDebugSettings = {
  enabled: false, weather: 'normal', timeMinutes: null, decayAmount: null,
};

export interface WorldDebugProjection {
  date: number | null;
  weather: ExternalWeatherVisualOverride | null;
  decayAmount: number | null;
}

export function projectWorldDebug(settings: WorldDebugSettings, nowMs: number): WorldDebugProjection | null {
  if (!settings.enabled) return null;
  let date: number | null = null;
  if (settings.timeMinutes !== null && Number.isFinite(settings.timeMinutes) && Number.isFinite(nowMs)) {
    const minutes = Math.max(0, Math.min(1439, Math.round(settings.timeMinutes)));
    const instant = new Date(nowMs);
    instant.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    date = instant.getTime();
  }
  const kind = settings.weather === 'storm' ? 'rain' : settings.weather;
  const weather: ExternalWeatherVisualOverride | null = kind === 'normal' ? null : {
    kind,
    ...(settings.weather === 'storm' ? { thunderstorm: true } : {}),
    cloudIntensity: settings.weather === 'storm' ? 1 : kind === 'clear' ? 0.12 : kind === 'cloudy' ? 0.72 : 0.5,
    precipitationIntensity: kind === 'rain' || kind === 'snow' ? settings.weather === 'storm' ? 1 : 0.12 : 0,
  };
  const decayAmount = settings.decayAmount !== null && Number.isFinite(settings.decayAmount)
    ? Math.max(0, Math.min(1, settings.decayAmount)) : null;
  return { date, weather, decayAmount };
}

export function debugTimeLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function parseDebugTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}
