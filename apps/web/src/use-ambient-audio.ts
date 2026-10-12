import {useEffect,useState} from 'react';
import type {WorldEnvironmentStyle} from '@blockcolc/domain';
import {ambientSources,defaultAmbience,type AmbientPreferences} from './ambient-preferences';
import {configureAmbience,resumeAmbientGesture} from './ambient-audio';
import {localDateForDate,weatherForLocalDate} from '@blockcolc/voxel/environment';
import type {ExternalWeatherVisual} from './qweather-visual';
import type {WorldDebugProjection} from './world-debug';

export function ambientWeatherKind(environment:WorldEnvironmentStyle,real:ExternalWeatherVisual|null,debug:WorldDebugProjection|null,now:number):string {
  return debug?.weather?.kind??real?.kind??weatherForLocalDate(localDateForDate(new Date(debug?.date??now)),environment==='ocean-island').kind;
}
export function useAmbientAudio(preferences:AmbientPreferences|undefined,environment:WorldEnvironmentStyle,real:ExternalWeatherVisual|null,debug:WorldDebugProjection|null){
  const [now,setNow]=useState(Date.now);
  const value=preferences??defaultAmbience(),key=ambientSources(value,ambientWeatherKind(environment,real,debug,now)).join(',');
  useEffect(()=>{if(!value.rainEnabled)return;const update=()=>setNow(Date.now()),timer=window.setInterval(update,60_000);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);};},[value.rainEnabled]);
  useEffect(()=>{void configureAmbience(key?key.split(','):[],value.volume).catch(()=>{});},[key,value.volume]);
  useEffect(()=>{window.addEventListener('pointerdown',resumeAmbientGesture,{passive:true});return()=>window.removeEventListener('pointerdown',resumeAmbientGesture);},[]);
}
