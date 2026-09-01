import { expect, test } from 'vitest';
import { SMALL_WORKSHOP_BLUEPRINT } from '../src/blueprint';
import { layoutWorlds } from '../src/renderer';
import { createSteppedTerrainData } from '../src/terrain';
import { roadCellsForVillage } from '../src/village';
test('dumps the ocean terrain center material mix', () => {
  const placements = layoutWorlds([{ projectId: 'a', blueprintId: SMALL_WORKSHOP_BLUEPRINT.id, buildingCompletionBasisPoints: 10000, buildingConditionBasisPoints: 10000, isMonument: false, settlementIndex: 0 }]);
  const terrain = createSteppedTerrainData(placements, roadCellsForVillage(placements), [], undefined, { environmentStyle: 'ocean-island', worldSeed: 'sea-a' });
  const found: Array<[number, number, number, number]> = [];
  const positions = terrain.positions;
  for (const material of ['dirt', 'stone', 'water'] as const) {
    const indices = terrain.indicesByMaterial[material];
    for (let base = 0; base + 2 < indices.length; base += 6) {
      const p0 = indices[base]! * 3;
      const p2 = indices[base + 2]! * 3;
      const cx = (positions[p0]! + positions[p2]!) / 2;
      const cz = (positions[p0 + 2]! + positions[p2 + 2]!) / 2;
      const cy = positions[p0 + 1]!;
      if (Math.max(Math.abs(cx), Math.abs(cz)) <= 42.85) found.push([Math.round(cx), Math.round(cz), cy, material === 'water' ? 1 : material === 'stone' ? 2 : 3]);
    }
  }
  // eslint-disable-next-line no-console
  console.log('CENTER_MIX ' + JSON.stringify(found.slice(0, 40)) + ' n=' + found.length);
  expect(true).toBe(true);
});
