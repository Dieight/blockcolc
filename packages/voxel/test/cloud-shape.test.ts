import {describe,it,expect} from 'vitest';
import {cloudVoxels} from '../src/cloud-shape';
describe('voxel cloud genera',()=>{
  it.each(['cirrus','cumulus','altocumulus','stratus','storm','bank'] as const)('%s has cubic, deterministic stepped surfaces on all faces',kind=>{
    const cells=cloudVoxels(kind,42);expect(cells).toEqual(cloudVoxels(kind,42));expect(cells.length).toBeGreaterThan(25);expect(cells.length).toBeLessThan(700);
    expect(new Set(cells.map(cell=>JSON.stringify(cell))).size).toBe(cells.length);
    expect(cells.every(cell=>Object.values(cell).every(Number.isInteger))).toBe(true);
    const layers=new Map<number,number>();cells.forEach(c=>layers.set(c.y,(layers.get(c.y)??0)+1));expect(new Set(layers.values()).size).toBeGreaterThan(1);
  });
  it('keeps storm towers taller and distant banks broader than small fair-weather clouds',()=>{
    const extent=(kind:Parameters<typeof cloudVoxels>[0],axis:'x'|'y'|'z')=>{const v=cloudVoxels(kind,42).map(c=>c[axis]);return Math.max(...v)-Math.min(...v);};
    expect(extent('storm','y')).toBeGreaterThan(extent('cumulus','y'));expect(extent('bank','x')).toBeGreaterThan(extent('cumulus','x'));expect(extent('cirrus','y')).toBeLessThan(extent('storm','y'));
  });
});
