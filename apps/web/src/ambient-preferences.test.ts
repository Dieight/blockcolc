import {expect,it} from 'vitest';
import {ambientSources,defaultAmbience,parseAmbience,normalizeAmbientSources,AMBIENT_TRACKS,AMBIENT_TITLES,ambientBuiltinAsset} from './ambient-preferences';
import {ambientWeather,ambientWeatherKind} from './use-ambient-audio';
it('is silent by default and one recording applies to every environment',()=>{
  const preferences=defaultAmbience();expect(ambientSources(preferences,'clear')).toEqual([]);
  preferences.enabled=true;expect(ambientSources(preferences,'clear')).toEqual(['forest-birds']);
  preferences.primary='shore-waves';expect(ambientSources(preferences,'rain')).toEqual(['shore-waves']);
});
it('keeps the approved full recordings exclusive and streams only their compressed assets',()=>{
  expect(AMBIENT_TRACKS).toEqual(['forest-birds','shore-waves']);
  for(const primary of AMBIENT_TRACKS){
    const preferences=parseAmbience({enabled:true,primary,rainEnabled:true,volume:35});
    expect(preferences.primary).toBe(primary);expect(ambientSources(preferences,'rain')).toEqual([primary,'rain']);
    expect(normalizeAmbientSources([primary,...AMBIENT_TRACKS,'rain'])).toEqual([primary,'rain']);
    expect(AMBIENT_TITLES[primary]).toBeTruthy();
    expect(ambientBuiltinAsset(primary)).toBe(`audio/${primary}.ogg`);
  }
  expect(ambientBuiltinAsset('rain')).toBeNull();
  for(const source of ['../calm-ocean','morning-birdsong','calm-ocean','evening-lakeside','a'.repeat(64)])expect(ambientBuiltinAsset(source)).toBeNull();
});
it('migrates old mixes to one imported track, bounds volume and rejects paths',()=>{
  const imports=['a','b','c','d'].map(char=>char.repeat(64));
  const preferences=parseAmbience({enabled:true,environments:['ocean-island','bad'],imports:['../../file',...imports,imports[0]],volume:120});
  expect(preferences).toEqual({enabled:true,volume:100,primary:imports[0],rainEnabled:false});
  expect(ambientSources(preferences,'clear')).toEqual([imports[0]]);
  expect(parseAmbience({primary:'../../secret'}).primary).toBe('forest-birds');
  expect(parseAmbience(null)).toEqual(defaultAmbience());
});
it('rain is an independent optional weather layer, never a second main track',()=>{
  const value={...defaultAmbience(),enabled:true,rainEnabled:true};
  expect(ambientSources(value,'rain')).toEqual(['forest-birds','rain']);
  expect(ambientSources(value,'storm')).toEqual(['forest-birds','rain']);
  for(const weather of ['clear','cloudy','snow','mist'])expect(ambientSources(value,weather)).toEqual(['forest-birds']);
  expect(ambientSources({...value,enabled:false},'rain')).toEqual(['rain']);
  expect(normalizeAmbientSources(['ocean','evening-lakeside','morning-birdsong','calm-ocean','forest-birds','a'.repeat(64),'rain','rain','../secret'])).toEqual(['forest-birds','rain']);
});
it.each(['evening-lakeside','morning-birdsong','calm-ocean'])('safely retires %s without changing rain or starting a substitute',primary=>{
  const retired=parseAmbience({enabled:true,primary,rainEnabled:true,volume:42});
  expect(retired).toEqual({enabled:false,primary:'forest-birds',rainEnabled:true,volume:42});
  expect(ambientSources(retired,'clear')).toEqual([]);expect(ambientSources(retired,'rain')).toEqual(['rain']);
  expect(normalizeAmbientSources([primary])).toEqual([]);
  const imported='a'.repeat(64);expect(parseAmbience({enabled:true,primary:imported}).primary).toBe(imported);
});
it('rain follows the same debug then real then local precedence as the world',()=>{
  const now=Date.parse('2026-10-11T04:00:00Z');
  const rain={kind:'rain',cloudIntensity:1,precipitationIntensity:1} as const;
  expect(ambientWeatherKind('ocean-island',rain,null,now)).toBe('rain');
  expect(ambientWeather('ocean-island',rain,null,now).precipitationIntensity).toBe(1);
  expect(ambientWeather('ocean-island',rain,{date:null,weather:{kind:'rain',precipitationIntensity:.12},decayAmount:null},now).precipitationIntensity).toBe(.12);
  expect(ambientWeatherKind('ocean-island',rain,{date:null,weather:{kind:'clear',cloudIntensity:0,precipitationIntensity:0},decayAmount:null},now)).toBe('clear');
  expect(['clear','cloudy','rain','mist']).toContain(ambientWeatherKind('natural-valley',null,null,now));
});
