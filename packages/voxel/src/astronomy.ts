import { getMoonIllumination, getMoonPosition, getPosition } from "suncalc";

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export type QWeatherMoonPhase =
  | "new-moon" | "waxing-crescent" | "first-quarter" | "waxing-gibbous"
  | "full-moon" | "waning-gibbous" | "last-quarter" | "waning-crescent";

export interface AstronomyDay {
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

export interface AstronomySchedule {
  coordinates: GeoCoordinates;
  locationSource: "fresh" | "cached";
  fetchedAtMs: number;
  days: readonly AstronomyDay[];
  attribution: readonly string[];
}

export interface AstronomyContext {
  coordinates: GeoCoordinates;
  schedule: AstronomySchedule | null;
  locationSource: "fresh" | "cached";
}

export interface CelestialPosition {
  /** SunCalc 2.x degrees, measured clockwise from geographic north. */
  azimuthDeg: number;
  /** Apparent altitude in degrees, including SunCalc's standard refraction. */
  altitudeDeg: number;
}

export interface LunarIllumination {
  fraction: number;
  phase: number;
  angleDeg: number;
  waxing: boolean;
}

export function sunPositionAt(date: Date, coordinates: GeoCoordinates): CelestialPosition | null {
  if (!validInput(date, coordinates)) return null;
  const position = getPosition(date, coordinates.latitude, coordinates.longitude);
  return finitePosition(position.azimuth, position.altitude);
}

export function moonPositionAt(date: Date, coordinates: GeoCoordinates): CelestialPosition | null {
  if (!validInput(date, coordinates)) return null;
  const position = getMoonPosition(date, coordinates.latitude, coordinates.longitude);
  return finitePosition(position.azimuth, position.altitude);
}

export function moonIlluminationAt(date: Date): LunarIllumination | null {
  if (!Number.isFinite(date.getTime())) return null;
  const illumination = getMoonIllumination(date);
  if (![illumination.fraction, illumination.phase, illumination.angle].every(Number.isFinite)) return null;
  return {
    fraction: Math.min(1, Math.max(0, illumination.fraction)),
    phase: ((illumination.phase % 1) + 1) % 1,
    angleDeg: illumination.angle,
    waxing: illumination.waxing,
  };
}

/** QWeather supplies event calendars; interval ownership is UTC epoch based. */
export function astronomyDayAt(schedule: AstronomySchedule | null, nowMs: number): AstronomyDay | null {
  if (!schedule || !Number.isFinite(nowMs)) return null;
  return schedule.days.find(day => Number.isFinite(day.intervalStartMs)
    && Number.isFinite(day.intervalEndMs)
    && day.intervalStartMs <= nowMs && nowMs < day.intervalEndMs) ?? null;
}

function validInput(date: Date, coordinates: GeoCoordinates): boolean {
  return Number.isFinite(date.getTime()) && Number.isFinite(coordinates.latitude)
    && Number.isFinite(coordinates.longitude) && coordinates.latitude >= -90
    && coordinates.latitude <= 90 && coordinates.longitude >= -180 && coordinates.longitude <= 180;
}

function finitePosition(azimuthDeg: number, altitudeDeg: number): CelestialPosition | null {
  if (!Number.isFinite(azimuthDeg) || !Number.isFinite(altitudeDeg)) return null;
  return { azimuthDeg, altitudeDeg };
}
