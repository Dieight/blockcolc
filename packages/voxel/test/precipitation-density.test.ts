import { describe,expect,it } from 'vitest';
import { precipitationCountForVolume } from '../src/precipitation-density';

const input={referenceCount:72,qualityDensity:1,spanX:80,spanZ:80,spanY:40,capacity:32_768};
describe('world-space precipitation density',()=>{
  it('scales with viewed volume, rather than spreading a fixed count over zoomed-out land',()=>{
    expect(precipitationCountForVolume(input)).toBe(72);
    expect(precipitationCountForVolume({...input,spanX:160,spanZ:160})).toBe(288);
    expect(precipitationCountForVolume({...input,spanX:160,spanZ:160,spanY:80})).toBe(576);
    expect(precipitationCountForVolume({...input,qualityDensity:.5})).toBe(36);
  });
  it('bounds extreme scenes and refuses invalid/disabled weather',()=>{
    expect(precipitationCountForVolume({...input,spanX:4096,spanZ:4096,spanY:500})).toBe(32_768);
    for(const overrides of [{referenceCount:0},{qualityDensity:0},{spanX:NaN},{spanY:-1},{capacity:0}])
      expect(precipitationCountForVolume({...input,...overrides})).toBe(0);
  });
});
