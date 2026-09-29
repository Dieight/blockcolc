import { moonIlluminationAt, moonPositionAt, sunPositionAt, type GeoCoordinates } from "./astronomy";
import { type DayPhase, type SunState } from "./lighting";
import { applyNightReadability } from "./night-readability";

const CELESTIAL_RADIUS = 18;
// SunCalc returns apparent lunar altitude too; include only the lunar disc
// radius here. Refraction is already included in the position.
const APPARENT_MOON_UPPER_LIMB_DEG = -0.25;

/** Geographic azimuth is degrees clockwise from north; world north is -Z. */
export function celestialWorldDirection(azimuthDeg: number, altitudeDeg: number): readonly [number, number, number] {
  if (!Number.isFinite(azimuthDeg) || !Number.isFinite(altitudeDeg)) return [0, 0, 0];
  const azimuth = degreesToRadians(azimuthDeg);
  const altitude = degreesToRadians(altitudeDeg);
  const horizontal = Math.cos(altitude);
  return [Math.sin(azimuth) * horizontal, Math.sin(altitude), -Math.cos(azimuth) * horizontal];
}

/** Returns null only for unusable input; callers then retain synthetic lighting. */
export function sunStateForAstronomy(date: Date, coordinates: GeoCoordinates): SunState | null {
  const sun = sunPositionAt(date, coordinates);
  const moon = moonPositionAt(date, coordinates);
  const illumination = moonIlluminationAt(date);
  if (!sun || !moon || !illumination) return null;

  const day = smoothstep(-12, 6, sun.altitudeDeg);
  const nightFactor = 1 - smoothstep(-8, -2, sun.altitudeDeg);
  // SunCalc 2.x altitude is already apparent (refracted). Use the upper-limb
  // crossing for the apparent solar disc; applying the -0.833° geometric
  // horizon here would count refraction twice.
  const directSunIntensity = smoothstep(-0.267, 4, sun.altitudeDeg);
  const twilightWarmth = smoothstep(-8, -1, sun.altitudeDeg)
    * (1 - smoothstep(5, 18, sun.altitudeDeg));
  const starVisibility = 1 - smoothstep(-18, -8, sun.altitudeDeg);
  const moonVisibility = smoothstep(APPARENT_MOON_UPPER_LIMB_DEG, 3, moon.altitudeDeg);
  const moonAmbient = moonVisibility * illumination.fraction;
  const rising = solarAltitudeAt(date, coordinates) <= solarAltitudeAt(new Date(date.getTime() + 10 * 60_000), coordinates);
  const phase: DayPhase = sun.altitudeDeg >= 0 ? "day"
    : sun.altitudeDeg > -2 ? (rising ? "dawn" : "dusk")
      : sun.altitudeDeg > -6 ? "civil-twilight"
        : sun.altitudeDeg > -12 ? "nautical-twilight"
          : sun.altitudeDeg > -18 ? "astronomical-twilight" : "night";

  const sunPosition = scale(celestialWorldDirection(sun.azimuthDeg, sun.altitudeDeg), CELESTIAL_RADIUS);
  const moonPosition = scale(celestialWorldDirection(moon.azimuthDeg, moon.altitudeDeg), CELESTIAL_RADIUS);
  // A below-horizon sun still controls twilight color, but must not illuminate
  // the world from underneath. Keep its true azimuth and clamp only light height.
  const position = scale(celestialWorldDirection(sun.azimuthDeg, Math.max(3, sun.altitudeDeg)), CELESTIAL_RADIUS);
  const skyColor = mixColor(mixColor(0x17243a, 0xb9cddd, day), 0xd98969, twilightWarmth * 0.72);
  const skyZenithColor = mixColor(mixColor(0x0d1930, 0x669cc3, day), 0x765f83, twilightWarmth * 0.24);
  const skyHorizonColor = mixColor(skyColor, 0xe49a75, twilightWarmth * 0.45);
  const skyLowerColor = mixColor(mixColor(0x182536, 0xc8d5d2, day), 0xc77b68, twilightWarmth * 0.3);
  const cloudColor = mixColor(mixColor(0x344256, 0xe7ece8, day), 0xf0b28e, twilightWarmth * 0.3);
  const state: SunState = {
    phase,
    position,
    sunPosition,
    moonPosition,
    sunVisibility: directSunIntensity,
    moonVisibility,
    starVisibility,
    intensity: 0.92 + day * (0.56 + directSunIntensity * 0.5),
    directSunIntensity,
    color: mixColor(mixColor(0x9db7d9, 0xfff1ce, day), 0xffae68, twilightWarmth * 0.78),
    skyColor,
    skyZenithColor,
    skyHorizonColor,
    skyLowerColor,
    cloudColor,
    fogColor: mixColor(mixColor(0x263444, 0xadc1b8, day), 0xc98269, twilightWarmth * 0.42),
    hemisphereSkyColor: mixColor(0x7895b5, 0xf4f0dc, day),
    hemisphereGroundColor: mixColor(0x24382d, 0x4d6659, day),
    hemisphereIntensity: 1.24 + day * -0.12,
    exposure: 1.28 + day * -0.06,
    nightFactor,
    sunAzimuthDeg: sun.azimuthDeg,
    sunAltitudeDeg: sun.altitudeDeg,
    moonAzimuthDeg: moon.azimuthDeg,
    moonAltitudeDeg: moon.altitudeDeg,
    moonIllumination: illumination.fraction,
    moonPhase: illumination.phase,
    moonWaxing: illumination.waxing,
    moonBrightLimbAngleDeg: illumination.angleDeg,
  };
  return applyNightReadability(state, moonAmbient);
}

function solarAltitudeAt(date: Date, coordinates: GeoCoordinates): number {
  return sunPositionAt(date, coordinates)?.altitudeDeg ?? Number.NEGATIVE_INFINITY;
}

function scale(value: readonly [number, number, number], radius: number): readonly [number, number, number] {
  return [value[0] * radius, value[1] * radius, value[2] * radius];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}

function mix(from: number, to: number, amount: number): number { return from + (to - from) * amount; }

function mixColor(from: number, to: number, amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  const channel = (shift: number) => Math.round(mix((from >> shift) & 0xff, (to >> shift) & 0xff, t));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function degreesToRadians(value: number): number { return value * Math.PI / 180; }
