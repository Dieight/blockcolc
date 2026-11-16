import {describe,it,expect} from 'vitest';
import {roadLampCells,ROAD_LAMP_SPACING} from '../src/road-lamps';
import type {VillagePlacement} from '../src/village';
describe('sparse road lamps',()=>{
  const roads=Array.from({length:600},(_,i)=>({x:i%100,z:Math.floor(i/100)*20}));
  it('is order independent, bounded and widely spaced',()=>{
    const cells=roadLampCells(roads,[]);
    expect(cells).toEqual(roadLampCells([...roads].reverse(),[]));
    expect(cells.length).toBeGreaterThan(0);expect(cells.length).toBeLessThanOrEqual(6);
    for(const a of cells)for(const b of cells)if(a!==b)expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeGreaterThanOrEqual(ROAD_LAMP_SPACING);
    expect(roadLampCells(roads.slice(0,31),[])).toEqual([]);
  });
  it('does not place a pole in a building footprint or entrance apron',()=>{
    const placement={worldPosition:{x:50,y:0,z:40},footprint:{width:100,depth:100}} as VillagePlacement;
    expect(roadLampCells(roads,[placement]).every(p=>p.z>92)).toBe(true);
  });
});
