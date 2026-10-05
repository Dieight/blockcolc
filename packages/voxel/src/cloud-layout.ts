import type { CloudBudget, WeatherState } from './environment';

export type CloudRegion = 'near' | 'far';
export type CloudKind = 'cirrus' | 'cumulus' | 'stratus' | 'storm' | 'bank';
export interface CloudGroup {
  region: CloudRegion;
  kind: CloudKind;
  x: number;
  z: number;
  blocks: number;
  horizontalScale: number;
}

/** Weather seeds own layout. The grid is jittered, not a ring around tasks. */
export function cloudGroupsForBudget(budget: CloudBudget,
  weather: Pick<WeatherState, 'kind' | 'thunderstorm'>, random: () => number): CloudGroup[] {
  const groups: CloudGroup[] = [];
  let nearIndex = 0, farIndex = 0, blocksUsed = 0;
  const shiftX = random(), shiftZ = random(), shiftStrip = random();
  for (let index = 0; index < budget.cloudCount; index++) {
    // Interleave regions so reducing a draw prefix never removes the far sky.
    const region: CloudRegion = Math.ceil((index + 1) * budget.nearCloudCount / budget.cloudCount) > nearIndex ? 'near' : 'far';
    const groupIndex = region === 'near' ? nearIndex++ : farIndex++;
    let kind: CloudKind = cloudKindForWeather(weather, random());
    const overcast = weather.kind === 'cloudy' || weather.kind === 'rain' || weather.kind === 'snow';
    if (!budget.previewMode && region === 'far' && overcast && groupIndex % 3 === 0) kind = 'bank';
    // Wide weather sheets belong to the horizon, not the construction window.
    // Only cloudy skies may carry stratus near the camera; clear skies never
    // scale a single far cloud into a giant sheet either.
    if(region==='near'&&weather.kind!=='cloudy'&&!budget.previewMode)
      kind=weather.thunderstorm||weather.kind==='rain'?'storm':weather.kind==='snow'?'cumulus':'cirrus';
    const blocks = budget.previewMode ? kind === 'cirrus' ? 3 + Math.floor(random() * 3) : 4 + Math.floor(random() * 4)
      : region==='near'&&weather.kind!=='cloudy' ? 5+Math.floor(random()*3)
        : kind === 'bank' ? 22 + Math.floor(random() * 8) : kind === 'cirrus' ? 5 + Math.floor(random() * 3)
        : kind === 'stratus' || kind === 'storm' ? 10 + Math.floor(random() * 5) : 8 + Math.floor(random() * 4);
    if (blocksUsed + blocks > budget.maxInstances) break;
    let x: number, z: number;
    if (budget.previewMode) {
      const angle = random() * Math.PI * 2;
      const radius = .03 + .38 * Math.pow(random(), 2.4);
      x = Math.cos(angle) * budget.spanX * .5 * radius;
      z = Math.sin(angle) * budget.spanZ * .5 * radius;
    } else if (region === 'near') {
      // A few small clouds remain in the ordinary building window. Remaining
      // groups cover the full near-detail terrain instead of piling over tasks.
      const fraction = groupIndex < 3 ? .22 : 1;
      x = (fract(radicalInverse(groupIndex + 1, 2) + shiftX) - .5) * budget.nearSpanX * fraction;
      z = (fract(radicalInverse(groupIndex + 1, 3) + shiftZ) - .5) * budget.nearSpanZ * fraction;
    } else {
      [x, z] = farPoint(budget,
        fract(radicalInverse(groupIndex + 1, 5) + shiftStrip),
        fract(radicalInverse(groupIndex + 1, 2) + shiftX),
        fract(radicalInverse(groupIndex + 1, 3) + shiftZ));
    }
    groups.push({ region, kind, x, z, blocks,
      horizontalScale: region === 'far'&&weather.kind!=='clear' ? budget.farBlockScale : 1 });
    blocksUsed += blocks;
  }
  return groups;
}

function cloudKindForWeather(weather: Pick<WeatherState, 'kind' | 'thunderstorm'>, roll: number): Exclude<CloudKind, 'bank'> {
  if (weather.thunderstorm) return roll < .94 ? 'storm' : 'stratus';
  if (weather.kind === 'rain') return roll < .68 ? 'storm' : roll < .88 ? 'cumulus' : 'stratus';
  if (weather.kind === 'mist') return roll < .88 ? 'stratus' : 'cirrus';
  if (weather.kind === 'snow') return roll < .7 ? 'stratus' : 'cumulus';
  if (weather.kind === 'cloudy') return roll < .55 ? 'stratus' : roll < .8 ? 'cumulus' : 'cirrus';
  return roll < .48 ? 'cirrus' : 'cumulus';
}

/** Four disjoint strips cover even the corners of a square/rectangular LOD. */
function farPoint(budget: CloudBudget, areaPick: number, u: number, v: number): [number, number] {
  const halfX = budget.spanX / 2, halfZ = budget.spanZ / 2;
  const nearX = budget.nearSpanX / 2, nearZ = budget.nearSpanZ / 2;
  const strips = [
    [-halfX, -nearX, -halfZ, halfZ], [nearX, halfX, -halfZ, halfZ],
    [-nearX, nearX, -halfZ, -nearZ], [-nearX, nearX, nearZ, halfZ],
  ] as const;
  const areas = strips.map(([x0, x1, z0, z1]) => (x1 - x0) * (z1 - z0));
  let pick = areaPick * areas.reduce((sum, area) => sum + area, 0);
  for (let index = 0; index < strips.length; index++) {
    const area = areas[index]!;
    if (area <= 0) continue;
    if (pick < area || index === strips.length - 1) {
      const [x0, x1, z0, z1] = strips[index]!;
      return [x0 + (x1 - x0) * u, z0 + (z1 - z0) * v];
    }
    pick -= area;
  }
  return [0, 0];
}

function fract(value: number): number { return value - Math.floor(value); }
function radicalInverse(value: number, base: number): number {
  let result = 0, divisor = base;
  for (let digit = value; digit > 0; digit = Math.floor(digit / base), divisor *= base) result += (digit % base) / divisor;
  return result;
}

/** Quality changes keep whole connected groups, never half of a cloud bank. */
export function cloudDrawCountForQuality(groupEnds: readonly number[], density: number): number {
  if (groupEnds.length === 0 || !Number.isFinite(density) || density <= 0) return 0;
  const target = groupEnds.at(-1)! * Math.min(1, density);
  let count = groupEnds[0]!;
  for (const end of groupEnds) { if (end > target) break; count = end; }
  return count;
}
