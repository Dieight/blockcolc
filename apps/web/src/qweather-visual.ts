/** Translate only documented QWeather condition/precipitation facts. The
 * renderer receives presentation state, never API credentials or location. */
export interface QWeatherVisualInput {
  conditionCode: string;
  cloudCover?: number;
  precipitationType?: 'rain' | 'snow' | 'ice' | 'mixed' | 'none' | 'unknown';
  precipitationIntensity?: number | { value: number; unit: string };
}

export interface ExternalWeatherVisual {
  kind: 'clear' | 'cloudy' | 'rain' | 'mist' | 'snow';
  cloudIntensity: number;
  precipitationIntensity: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** QWeather's 302–304 condition codes explicitly identify thunder. Ordinary
 * shower/rain codes must not trigger the minimal panel lightning effect. */
export function qweatherIsThunderstorm(conditionCode: string): boolean {
  return /^(302|303|304)$/.test(conditionCode);
}

function precipitationMmPerHour(input: QWeatherVisualInput['precipitationIntensity']): number | null {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? input : null;
  if (!input || !Number.isFinite(input.value) || input.value < 0) return null;
  const unit = input.unit.trim().toLowerCase();
  if (unit === 'mm/h' || unit === 'mm/hr' || unit === 'mm/hour') return input.value;
  if (unit === 'in/h' || unit === 'in/hr' || unit === 'inch/hour') return input.value * 25.4;
  return null;
}

export function qweatherVisual(input: QWeatherVisualInput): ExternalWeatherVisual | null {
  const code = input.conditionCode;
  const precipitation = input.precipitationType;
  const rain = precipitation === 'rain' || (precipitation !== 'snow' && precipitation !== 'ice' && precipitation !== 'mixed' && /^3\d\d$/.test(code));
  const snow = precipitation === 'snow' || precipitation === 'ice' || precipitation === 'mixed' || /^4\d\d$/.test(code);
  const mist = /^50[0129]$/.test(code) || /^51[0-5]$/.test(code);
  let kind: ExternalWeatherVisual['kind'];
  if (snow) kind = 'snow';
  else if (rain) kind = 'rain';
  else if (mist) kind = 'mist';
  else if (code === '100' || code === '103') kind = 'clear';
  else if (/^10[124]$/.test(code) || /^5\d\d$/.test(code)) kind = 'cloudy';
  else return null; // Unknown/future conditions retain the local fallback.
  const fallbackCloud = kind === 'clear' ? 0.15 : kind === 'cloudy' ? 0.65 : kind === 'mist' ? 0.8 : 0.85;
  const cloudIntensity = clamp01(input.cloudCover ?? fallbackCloud);
  const precipitationIntensity = kind === 'rain' || kind === 'snow'
    ? clamp01((precipitationMmPerHour(input.precipitationIntensity) ?? 1.5) / 5)
    : 0;
  return { kind, cloudIntensity, precipitationIntensity };
}
