import { describe,expect,it } from 'vitest';
import * as THREE from 'three';
import { sunStateForLocalTime } from '../src/lighting';
import { weatherForExternalOverride } from '../src/environment';
import { SkySpectacle, twilightPalette, nightSkyVisibility, solarAltitudeForSky, NIGHT_SKY_GLSL } from '../src/sky-spectacle';
import { mosaicColdDirection } from '../src/mosaic-terrain';
import { holidayBuildingBlueprint } from '../src/holiday-buildings';
import { holidaysForYear, parseDecorationBlueprint } from '@blockcolc/domain';
import { skyNoise3 } from '../src/sky-noise';
const base=sunStateForLocalTime(new Date(2026,1,1,0));
const clear=weatherForExternalOverride('2026-02-01',{kind:'clear'});
describe('shared solar/weather sky field',()=>{
 it('keeps the galaxy continuous across longitude, poles and lattice boundaries',()=>{
  const sample=(longitude:number,latitude:number)=>skyNoise3(Math.cos(longitude)*Math.cos(latitude)*7+4.3,Math.sin(latitude)*7+1.7,Math.sin(longitude)*Math.cos(latitude)*7+8.9);
  for(const latitude of [.1,.3,.7,1.2])expect(Math.abs(sample(-Math.PI+1e-7,latitude)-sample(Math.PI-1e-7,latitude))).toBeLessThan(1e-5);
  for(const longitude of [-3,-1,0,2,3])expect(Math.abs(sample(longitude,Math.PI/2-1e-7)-sample(0,Math.PI/2))).toBeLessThan(1e-5);
  for(const n of [-2,0,1,7])expect(Math.abs(skyNoise3(n-1e-6,.27,1.8)-skyNoise3(n+1e-6,.27,1.8))).toBeLessThan(1e-5);
  expect(NIGHT_SKY_GLSL).not.toContain('bcSkyNoise(uv');expect(NIGHT_SKY_GLSL).toContain('bcSkyCloud(d*7.0');
 });
 it('keeps daytime unchanged, adds red/pink twilight and a separate blue hour without changing physical light',()=>{
  const day={...base,sunAltitudeDeg:40};expect(twilightPalette(day,.3)).toEqual(day);
  const twilight={...base,sunAltitudeDeg:0};expect(twilightPalette(twilight,.1).skyHorizonColor).not.toBe(twilightPalette(twilight,.9).skyHorizonColor);
  expect(twilightPalette({...base,sunAltitudeDeg:-8}).skyZenithColor).not.toBe(base.skyZenithColor);
  expect(twilightPalette(twilight).sunVisibility).toBe(twilight.sunVisibility);
  const local={...base,sunAltitudeDeg:undefined,sunPosition:[100,-10,50] as const};expect(solarAltitudeForSky(local)).toBeLessThan(0);expect(twilightPalette(local)).not.toEqual(local);
 });
 it('suppresses stars with sun/cloud/thunder/moon, and limits aurora to the cold environment',()=>{
  const dark={...base,sunAltitudeDeg:-25,moonVisibility:0};const n=nightSkyVisibility(dark,clear,true);
  expect(n).toEqual({stars:1,galaxy:1,aurora:1});expect(nightSkyVisibility({...dark,sunAltitudeDeg:8},clear,true)).toEqual({stars:0,galaxy:0,aurora:0});
  expect(nightSkyVisibility(dark,clear,false).aurora).toBe(0);
  const rainy=weatherForExternalOverride('2026-02-01',{kind:'rain',thunderstorm:true});expect(nightSkyVisibility(dark,rainy,true)).toEqual({stars:0,galaxy:0,aurora:0});
  expect(nightSkyVisibility({...dark,moonVisibility:1,moonIllumination:1},clear,true).galaxy).toBeCloseTo(.38);
  for(const seed of ['a','b','world-default'])expect(Math.hypot(...mosaicColdDirection(seed))).toBeCloseTo(1);
 });
 it('shares stars, galaxy and meteor eligibility across all environments, with aurora only on the cold coast',()=>{
  const dark={...base,sunAltitudeDeg:-25,moonVisibility:1,moonIllumination:1};
  for(const style of ['ocean-island','classic-island','natural-valley','mosaic-coast']) {
    const s=new SkySpectacle();s.update(dark,clear,style==='mosaic-coast',false,.65);
    expect(s.uniforms.bcSkyStars.value).toBeCloseTo(.65);
    expect(s.uniforms.bcSkyGalaxy.value).toBeCloseTo(.38);
    expect(s.uniforms.bcSkyAurora.value>0).toBe(style==='mosaic-coast');
    s.tick(0,true);for(let time=500;time<=12500;time+=500)s.tick(time,true);
    expect(s.uniforms.bcSkyMeteor.value).toBeGreaterThan(0);
  }
 });
 it('advances at ambient-frame cadence, pauses hidden/reduced and schedules occasional meteors',()=>{
  const s=new SkySpectacle();s.update({...base,sunAltitudeDeg:-25,moonVisibility:0},clear,true,false,1);s.tick(0,true);
  for(let t=250;t<=12_500;t+=250)s.tick(t,true);expect(s.uniforms.bcSkyTime.value).toBe(12.5);expect(s.uniforms.bcSkyMeteor.value).toBeGreaterThan(0);
  s.tick(13_000,false);s.tick(40_000,true);expect(s.uniforms.bcSkyTime.value).toBe(12.5);
  s.update({...base,sunAltitudeDeg:-25},clear,true,true,1);expect(s.tick(41_000,true)).toBe(false);expect(s.uniforms.bcSkyMeteor.value).toBe(-1);
 });
 it('uses a computed lunar phase for local-source nights rather than a permanent full moon',()=>{
  const fresh=sunStateForLocalTime(new Date('2026-10-10T16:00:00Z'));
  const full=sunStateForLocalTime(new Date('2026-10-26T16:00:00Z'));
  expect(fresh.moonIllumination).toBeLessThan(.02);
  expect(full.moonIllumination).toBeGreaterThan(.97);
  expect(nightSkyVisibility(fresh,clear,false).galaxy).toBeGreaterThan(nightSkyVisibility(full,clear,false).galaxy);
 });
 it('composes existing hooks, shares the exact directional field/uniforms and patches once',()=>{
  const s=new SkySpectacle();const a=new THREE.MeshBasicMaterial(),b=new THREE.MeshStandardMaterial();let hooks=0;
  b.onBeforeCompile=()=>{hooks++;};for(const m of [a,b]){if(m===a)s.patchSky(m);else s.patchReflection(m as THREE.MeshStandardMaterial);}
  s.patchReflection(b);const shader=()=>({uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>',fragmentShader:'#include <common>\n#include <opaque_fragment>'});
  const sky=shader(),water=shader();a.onBeforeCompile(sky as never,{} as never);b.onBeforeCompile(water as never,{} as never);
  expect(hooks).toBe(1);for(const result of [sky,water]){expect(result.fragmentShader).toContain(NIGHT_SKY_GLSL);expect(result.uniforms).toMatchObject(s.uniforms);}
  expect(water.vertexShader).toContain('instanceMatrix');expect(water.fragmentShader).toContain('reflect(bcIncident,bcWorldNormal)');expect(water.fragmentShader).toContain('if(bcReflective>0.001)');
  expect(water.uniforms).toMatchObject({bcSkyReflectionGain:{value:1}});
  expect(sky.uniforms).not.toHaveProperty('bcSkyReflectionGain');
 });
});
describe('original yearly block keepsakes',()=>{
 it('provides twenty bounded, valid, deterministic and visibly distinct constructions',()=>{
  const shapes=new Set<string>();for(const h of holidaysForYear(2026)){const a=holidayBuildingBlueprint(h.id,h.buildingName);expect(parseDecorationBlueprint(a)).toEqual(a);expect(a.voxels.length).toBeLessThan(2000);expect(holidayBuildingBlueprint(h.id,h.buildingName)).toEqual(a);shapes.add(JSON.stringify(a.voxels));}
  expect(shapes.size).toBe(20);
 });
});
