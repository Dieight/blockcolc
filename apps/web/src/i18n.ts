import {useSyncExternalStore} from 'react';
import {EN} from './messages-en';
export type AppLanguage='zh-CN'|'en';
let language:AppLanguage='zh-CN';
try{if(JSON.parse(localStorage.getItem('blockcolc-focus-preferences-v1')??'{}').language==='en')language='en';}catch{/* Safe default on blocked/corrupt storage. */}
const listeners=new Set<()=>void>();
export const appLanguage=()=>language;
export const appLocale=()=>language==='en'?'en-US':'zh-CN';
export function setAppLanguage(next:AppLanguage){if(next===language)return;language=next;listeners.forEach(listener=>listener());}
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function useI18n(){return useSyncExternalStore(subscribe,appLanguage,()=> 'zh-CN' as const);}
// Shorten setting copy without changing storage or domain terminology.
const SHORT:Readonly<Record<string,string>>={
  '休息结束自动开始下一轮，锁屏时也按计划继续':'休息后自动续轮，锁屏也继续',
  '极简或马拉松休息结束且还有轮次时提醒回来专注':'休息结束时提醒续轮',
  '位置仅存本机；定位暂失时使用缓存，关闭即清除':'位置仅存本机，关闭即清除',
  '已开启 · 专注与休息会显示在流体云、锁屏和通知抽屉':'已开启 · 显示专注与休息状态',
  '系统未允许实时通知，专注与休息倒计时会退化到通知栏':'未获实时通知权限，使用普通通知',
  '先打开计时，世界稍后就绪；下次启动生效':'先开计时后载世界，下次启动生效',
  '点按地形时显示 x、z 与高度，便于定位世界问题':'点按地形查看坐标',
  '仅保留一份，每日合并变化并复用未变内容。上限 200 MiB；导出是完整备份，操作回滚另存。':'每日合并为一份，上限 200 MiB；操作回滚另存。',
};
const patterns=Object.entries(EN).filter(([key])=>/\{\d+\}/.test(key)).map(([key,value])=>({
  expression:new RegExp('^'+key.split(/(\{\d+\})/).map(part=>/^\{\d+\}$/.test(part)?'(.*?)':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('')+'$'),value,
}));
const resolved=new Map<string,string>();
function matchFormatted(source:string):string {
  const cached=resolved.get(source);if(cached!==undefined)return cached;
  for(const {expression,value} of patterns){const match=expression.exec(source);if(match){const text=value.replace(/\{(\d+)\}/g,(_,index)=>match[Number(index)+1]??'');if(resolved.size>=256)resolved.delete(resolved.keys().next().value!);resolved.set(source,text);return text;}}
  return source;
}
/** Explicit UI call sites only: never walk or modify the DOM or persisted data. */
export function t<T extends string>(source:T,...values:unknown[]):T {
  const translated=language==='en'?(EN[source]??(values.length===0&&/[\u3400-\u9fff]/.test(source)?matchFormatted(source):source)):(SHORT[source]??source);
  return translated.replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)]??'')) as T;
}
