import { describe,expect,it } from 'vitest';
import { precipitationGroundAt,precipitationGroundForSurfaces } from '../src/precipitation-ground';

describe('terrain-relative precipitation',()=>{
  it('retains high ground under rain instead of hiding the upper screen precipitation underground',()=>{
    const surfaces=[{minX:-4,maxX:0,minZ:-2,maxZ:2,supportY:40,water:false},{minX:0,maxX:4,minZ:-2,maxZ:2,supportY:1,water:false}];
    const before=structuredClone(surfaces),ground=precipitationGroundForSurfaces(surfaces);
    expect(precipitationGroundAt(ground,-2,0)).toBe(40);
    expect(precipitationGroundAt(ground,2,0)).toBe(1);
    expect(ground.maxY).toBe(40);expect(ground.minY).toBe(1);expect(surfaces).toEqual(before);
    expect(precipitationGroundForSurfaces([...surfaces].reverse())).toEqual(ground);
  });
  it('bounds memory for huge oceans and conservatively closes mixed-resolution steps',()=>{
    const ground=precipitationGroundForSurfaces([{minX:-1200,maxX:1200,minZ:-1200,maxZ:1200,supportY:0,water:true},
      {minX:0,maxX:2,minZ:0,maxZ:2,supportY:35,water:false}]);
    expect(ground.data.length).toBeLessThanOrEqual(512*512);
    expect(precipitationGroundAt(ground,1,1)).toBe(35);
    expect(precipitationGroundAt(ground,-999,-999)).toBe(0);
    expect(precipitationGroundAt(precipitationGroundForSurfaces([]),0,0)).toBe(0);
  });
});
