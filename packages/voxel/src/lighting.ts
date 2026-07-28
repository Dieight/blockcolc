export type DayPhase = "night" | "dawn" | "day" | "dusk";

export interface SunState {
  phase: DayPhase;
  position: readonly [number, number, number];
  sunPosition: readonly [number, number, number];
  moonPosition: readonly [number, number, number];
  sunVisibility: number;
  moonVisibility: number;
  starVisibility: number;
  intensity: number;
  color: number;
  skyColor: number;
  skyZenithColor: number;
  skyHorizonColor: number;
  skyLowerColor: number;
  cloudColor: number;
  fogColor: number;
  hemisphereSkyColor: number;
  hemisphereGroundColor: number;
  hemisphereIntensity: number;
  exposure: number;
  nightFactor: number;
}

export interface EmissivePoint {
  x: number;
  y: number;
  z: number;
  intensity: number;
}

export function sunStateForLocalTime(date: Date): SunState {
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const solarProgress = (hour - 6) / 12;
  const elevation = Math.sin(solarProgress * Math.PI);
  const dayFactor = smoothstep(-0.08, 0.2, elevation);
  const horizonWarmth = Math.max(0, 1 - Math.abs(elevation) / 0.42) * dayFactor;
  const nightFactor = 1 - dayFactor;
  const azimuth = (hour / 24) * Math.PI * 2 - Math.PI / 2;
  const daylight = elevation >= 0;
  const radius = 18;
  const sunPosition: readonly [number, number, number] = [
    Math.cos(azimuth) * radius,
    elevation * radius,
    Math.sin(azimuth) * radius,
  ];
  const moonPosition: readonly [number, number, number] = [-sunPosition[0], -sunPosition[1], -sunPosition[2]];
  const directionScale = daylight ? 1 : -1;
  const position: readonly [number, number, number] = [
    Math.cos(azimuth) * radius * directionScale,
    daylight ? 4 + elevation * 15 : 5 + (-elevation) * 7,
    Math.sin(azimuth) * radius * directionScale,
  ];
  const phase: DayPhase = dayFactor < 0.15 ? "night" : hour < 9 ? "dawn" : hour > 16.5 ? "dusk" : "day";
  const sunVisibility = smoothstep(-0.06, 0.08, elevation);
  const moonVisibility = smoothstep(-0.08, 0.12, -elevation);
  const starVisibility = smoothstep(0.12, 0.5, -elevation);
  const skyColor = mixColor(mixColor(0x111a2b, 0xb9cddd, dayFactor), 0xd98969, horizonWarmth * 0.62);
  const skyZenithColor = mixColor(mixColor(0x07101f, 0x669cc3, dayFactor), 0x765f83, horizonWarmth * 0.2);
  const skyHorizonColor = mixColor(skyColor, 0xe49a75, horizonWarmth * 0.42);
  const skyLowerColor = mixColor(mixColor(0x182536, 0xc8d5d2, dayFactor), 0xc77b68, horizonWarmth * 0.3);
  const cloudColor = mixColor(mixColor(0x344256, 0xe7ece8, dayFactor), 0xf0b28e, horizonWarmth * 0.3);

  return {
    phase,
    position,
    sunPosition,
    moonPosition,
    sunVisibility,
    moonVisibility,
    starVisibility,
    intensity: mix(0.36, 1.35 + Math.max(0, elevation) * 0.85, dayFactor),
    color: mixColor(mixColor(0x9db7d9, 0xfff1ce, dayFactor), 0xffae68, horizonWarmth * 0.72),
    skyColor,
    skyZenithColor,
    skyHorizonColor,
    skyLowerColor,
    cloudColor,
    fogColor: mixColor(mixColor(0x263444, 0xadc1b8, dayFactor), 0xc98269, horizonWarmth * 0.42),
    hemisphereSkyColor: mixColor(0x5d7899, 0xf4f0dc, dayFactor),
    hemisphereGroundColor: mixColor(0x17231e, 0x4d6659, dayFactor),
    hemisphereIntensity: mix(0.5, 0.72, dayFactor),
    exposure: mix(0.92, 0.98, dayFactor),
    nightFactor,
  };
}

export function clusterEmissivePoints(points: readonly EmissivePoint[], maximum: number): EmissivePoint[] {
  if (maximum <= 0 || points.length === 0) return [];
  if (points.length <= maximum) return points.map((point) => ({ ...point }));
  const sorted = [...points].sort((left, right) => right.intensity - left.intensity || left.x - right.x || left.z - right.z || left.y - right.y);
  const centers: EmissivePoint[] = [{ ...sorted[0]! }];
  while (centers.length < maximum) {
    const next = sorted.reduce((best, point) => {
      const distance = Math.min(...centers.map((center) => squaredDistance(point, center)));
      return distance > best.distance ? { point, distance } : best;
    }, { point: sorted[0]!, distance: -1 });
    centers.push({ ...next.point });
  }
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const groups = centers.map(() => [] as EmissivePoint[]);
    for (const point of points) {
      let nearest = 0;
      let nearestDistance = squaredDistance(point, centers[0]!);
      for (let index = 1; index < centers.length; index += 1) {
        const distance = squaredDistance(point, centers[index]!);
        if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
      }
      groups[nearest]!.push(point);
    }
    groups.forEach((group, index) => {
      if (group.length === 0) return;
      const weight = group.reduce((sum, point) => sum + Math.max(1, point.intensity), 0);
      centers[index] = {
        x: group.reduce((sum, point) => sum + point.x * Math.max(1, point.intensity), 0) / weight,
        y: group.reduce((sum, point) => sum + point.y * Math.max(1, point.intensity), 0) / weight,
        z: group.reduce((sum, point) => sum + point.z * Math.max(1, point.intensity), 0) / weight,
        intensity: Math.max(...group.map((point) => point.intensity)),
      };
    });
  }
  return centers;
}

function squaredDistance(left: EmissivePoint, right: EmissivePoint): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2 + (left.z - right.z) ** 2;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function mixColor(from: number, to: number, amount: number): number {
  const clamped = Math.max(0, Math.min(1, amount));
  const fromR = (from >> 16) & 0xff; const fromG = (from >> 8) & 0xff; const fromB = from & 0xff;
  const toR = (to >> 16) & 0xff; const toG = (to >> 8) & 0xff; const toB = to & 0xff;
  return (Math.round(mix(fromR, toR, clamped)) << 16)
    | (Math.round(mix(fromG, toG, clamped)) << 8)
    | Math.round(mix(fromB, toB, clamped));
}
