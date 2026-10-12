import {expect,it} from 'vitest';
import {ambientSources,defaultAmbience,parseAmbience,normalizeAmbientSources} from './ambient-preferences';
import {ambientWeatherKind} from './use-ambient-audio';
it('is silent by default and one recording applies to every environment',()=>{
  const preferences=defaultAmbience();expect(ambientSources(preferences,'clear')).toEqual([]);
  preferences.enabled=true;expect(ambientSources(preferences,'clear')).toEqual(['morning-birdsong']);
  preferences.primary='morning-birdsong';expect(ambientSources(preferences,'rain')).toEqual(['morning-birdsong']);
});
it('migrates old mixes to one imported track, bounds volume and rejects paths',()=>{
  const imports=['a','b','c','d'].map(char=>char.repeat(64));
  const preferences=parseAmbience({enabled:true,environments:['ocean-island','bad'],imports:['../../file',...imports,imports[0]],volume:120});
  expect(preferences).toEqual({enabled:true,volume:100,primary:imports[0],rainEnabled:false});
  expect(ambientSources(preferences,'clear')).toEqual([imports[0]]);
  expect(parseAmbience({primary:'../../secret'}).primary).toBe('morning-birdsong');
  expect(parseAmbience(null)).toEqual(defaultAmbience());
});
it('rain is an independent optional weather layer, never a second main track',()=>{
  const value={...defaultAmbience(),enabled:true,rainEnabled:true};
  expect(ambientSources(value,'rain')).toEqual(['morning-birdsong','rain']);
  expect(ambientSources(value,'storm')).toEqual(['morning-birdsong','rain']);
  for(const weather of ['clear','cloudy','snow','mist'])expect(ambientSources(value,weather)).toEqual(['morning-birdsong']);
  expect(ambientSources({...value,enabled:false},'rain')).toEqual(['rain']);
  expect(normalizeAmbientSources(['ocean','evening-lakeside','morning-birdsong','a'.repeat(64),'rain','rain','../secret'])).toEqual(['morning-birdsong','rain']);
});
it('disables the retired lakeside selection without changing rain or starting birdsong',()=>{
  const retired=parseAmbience({enabled:true,primary:'evening-lakeside',rainEnabled:true,volume:42});
  expect(retired).toEqual({enabled:false,primary:'morning-birdsong',rainEnabled:true,volume:42});
  expect(ambientSources(retired,'clear')).toEqual([]);expect(ambientSources(retired,'rain')).toEqual(['rain']);
  expect(normalizeAmbientSources(['evening-lakeside'])).toEqual([]);
  const imported='a'.repeat(64);expect(parseAmbience({enabled:true,primary:imported}).primary).toBe(imported);
});
it('rain follows the same debug then real then local precedence as the world',()=>{
  const now=Date.parse('2026-10-11T04:00:00Z');
  const rain={kind:'rain',cloudIntensity:1,precipitationIntensity:1} as const;
  expect(ambientWeatherKind('ocean-island',rain,null,now)).toBe('rain');
  expect(ambientWeatherKind('ocean-island',rain,{date:null,weather:{kind:'clear',cloudIntensity:0,precipitationIntensity:0},decayAmount:null},now)).toBe('clear');
  expect(['clear','cloudy','rain','mist']).toContain(ambientWeatherKind('natural-valley',null,null,now));
});
