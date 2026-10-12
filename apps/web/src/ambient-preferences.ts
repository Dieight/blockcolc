export const AMBIENT_TRACKS=['morning-birdsong'] as const;
export type AmbientTrack=(typeof AMBIENT_TRACKS)[number];
export interface AmbientPreferences{enabled:boolean;primary:string;rainEnabled:boolean;volume:number}
export const defaultAmbience=():AmbientPreferences=>({enabled:false,primary:'morning-birdsong',rainEnabled:false,volume:30});
export const isAmbientPrimary=(value:unknown):value is string=>typeof value==='string'&&(AMBIENT_TRACKS.includes(value as AmbientTrack)||/^[a-f0-9]{64}$/.test(value));
/** Enforce the same one-main-plus-rain contract at every playback boundary. */
export function normalizeAmbientSources(sources:readonly string[]):string[]{
  const main=sources.find(isAmbientPrimary);
  return [...(main?[main]:[]),...(sources.includes('rain')?['rain']:[])];
}
export function parseAmbience(value:unknown):AmbientPreferences {
  const defaults=defaultAmbience();if(!value||typeof value!=='object')return defaults;
  const raw=value as Record<string,unknown>;
  const legacy=Array.isArray(raw.imports)?raw.imports.find(isAmbientPrimary):undefined;
  // A removed recording must not silently start a different sound on upgrade.
  return{enabled:raw.enabled===true&&raw.primary!=='evening-lakeside',primary:isAmbientPrimary(raw.primary)?raw.primary:legacy??defaults.primary,rainEnabled:raw.rainEnabled===true,
    volume:typeof raw.volume==='number'&&Number.isFinite(raw.volume)?Math.max(0,Math.min(100,Math.round(raw.volume))):30};
}
export function ambientSources(preferences:AmbientPreferences,weather:string):string[]{
  return normalizeAmbientSources([...(preferences.enabled?[preferences.primary]:[]),...(preferences.rainEnabled&&(weather==='rain'||weather==='storm')?['rain']:[])]);
}
