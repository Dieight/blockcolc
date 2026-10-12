import { t, useI18n } from './i18n';
import {useEffect,useRef,useState} from 'react';
import type {FocusPreferences} from './app-types';
import {AMBIENT_TRACKS,defaultAmbience,type AmbientPreferences} from './ambient-preferences';
import {importAmbient,listAmbientImports,removeAmbient} from './ambient-audio';
import {isNativeAmbient,type AmbientImport} from '@blockcolc/platform-capacitor';
import {Reveal} from './ui/Reveal';
import {PhysicalSlider} from './ui/PhysicalSlider';
export function AmbientAudioSettings({preferences,onChange}:{preferences:FocusPreferences;onChange:(next:FocusPreferences)=>void}){
  useI18n();
  const value=preferences.ambience??defaultAmbience(),[items,setItems]=useState<AmbientImport[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),input=useRef<HTMLInputElement>(null);
  const lane=useRef(false),latest=useRef(preferences);latest.current=preferences;
  const update=(patch:Partial<AmbientPreferences>)=>onChange({...latest.current,ambience:{...(latest.current.ambience??defaultAmbience()),...patch}});
  useEffect(()=>{let live=true;void listAmbientImports().then(result=>{if(live)setItems(result);}).catch(()=>{if(live)setError(t("无法读取本机音频"));});return()=>{live=false;};},[]);
  const add=async(file?:File)=>{if(lane.current)return;lane.current=true;setBusy(true);setError('');try{const item=await importAmbient(file);if(item){setItems(await listAmbientImports());update({primary:item.id});}}catch(cause){setError(cause instanceof Error?cause.message:t("音频导入失败"));}finally{lane.current=false;setBusy(false);if(input.current)input.current.value='';}};
  const remove=async(id:string)=>{if(lane.current)return;lane.current=true;setBusy(true);setError('');try{await removeAmbient(id);setItems(await listAmbientImports());if(latest.current.ambience?.primary===id)update({primary:'morning-birdsong',enabled:false});}catch{setError(t('音频未能删除'));}finally{lane.current=false;setBusy(false);}};
  return <section className="settings-group ambient-audio-settings"><h2>{t("白噪音")}</h2><div className="settings-list">
    <div className="setting-row"><div className="setting-name"><span>{t('自然白噪音')}</span><small>{t('所有聚落共用一个声音')}</small></div><label className="switch-control ios-switch"><input aria-label={t('自然白噪音')} type="checkbox" checked={value.enabled} onChange={()=>update({enabled:!value.enabled})}/></label></div>
    <Reveal open={value.enabled}><div className="ambient-options">
      <div className="ambient-tracks" role="radiogroup" aria-label={t('主音轨')}>
        {AMBIENT_TRACKS.map(id=><label className="setting-row ambient-track" key={id}><span className="setting-name">{t('晨间鸟鸣')}</span><input type="radio" name="ambient-main" aria-label={t('晨间鸟鸣')} checked={value.primary===id} onChange={()=>update({primary:id})}/></label>)}
        {items.map(item=><div className="setting-row ambient-track" key={item.id}><label><span className="setting-name">{item.name}</span><input type="radio" name="ambient-main" aria-label={item.name} checked={value.primary===item.id} onChange={()=>update({primary:item.id})}/></label><button type="button" className="settings-text-action" disabled={busy} aria-label={t('删除音频：{0}',item.name)} onClick={()=>void remove(item.id)}>{t('删除')}</button></div>)}
      </div>
      <input hidden ref={input} type="file" accept="audio/*" onChange={event=>{const file=event.target.files?.[0];if(file)void add(file);}}/>
      <button type="button" className="settings-text-action" disabled={busy} aria-busy={busy} onClick={()=>isNativeAmbient()?void add():input.current?.click()}>{t("导入音频")}</button><small>{t('最多 8 份 · 单份 64 MiB · 主音轨仅播放一份')}</small>
    </div></Reveal>
    <div className="setting-row"><div className="setting-name"><span>{t('随天气播放雨声')}</span><small>{t('下雨时自动叠加，放晴停止')}</small></div><label className="switch-control ios-switch"><input aria-label={t('随天气播放雨声')} type="checkbox" checked={value.rainEnabled} onChange={()=>update({rainEnabled:!value.rainEnabled})}/></label></div>
    <Reveal open={value.enabled||value.rainEnabled}><div className="ambient-options"><div className="ambient-volume"><div className="ambient-volume-heading"><span>{t('白噪音音量')}</span><output>{value.volume}%</output></div><PhysicalSlider label={t('白噪音音量')} value={value.volume} onChange={volume=>update({volume})}/></div></div></Reveal>
    {error&&<p role="alert">{t(error)}</p>}
  </div></section>;
}
