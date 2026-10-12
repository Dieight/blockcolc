import {isNativeAmbient,nativeAmbientAudio,type AmbientImport} from '@blockcolc/platform-capacitor';
import {AMBIENT_TRACKS,normalizeAmbientSources,type AmbientTrack} from './ambient-preferences';

const database=()=>new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('blockcolc-ambient-audio',1);request.onupgradeneeded=()=>request.result.createObjectStore('audio',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const read=async<T>(operation:(store:IDBObjectStore)=>IDBRequest<T>,write=false)=>{const db=await database();try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction('audio',write?'readwrite':'readonly'),request=operation(tx.objectStore('audio'));let result:T;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});}finally{db.close();}};
interface AudioRecord extends AmbientImport{blob:Blob}
export async function listAmbientImports():Promise<AmbientImport[]>{if(isNativeAmbient())return(await nativeAmbientAudio.list()).items;return(await read(store=>store.getAll()) as AudioRecord[]).map(({blob:_blob,...info})=>info);}
export async function importAmbient(file?:File):Promise<AmbientImport|null>{
  if(isNativeAmbient()){const result=await nativeAmbientAudio.importAudio();return result.cancelled?null:result.item??null;}
  if(!file)return null;if(file.size>64*1024*1024||file.size===0)throw new Error('音频不能超过 64 MiB');
  const existing=await listAmbientImports();if(existing.length>=8)throw new Error('最多保存 8 份音频');
  const url=URL.createObjectURL(file),media=new Audio();
  let durationMs:number;
  try{durationMs=await new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('无法读取这份音频')),15_000);
    media.onloadedmetadata=()=>{clearTimeout(timer);resolve(Math.round(media.duration*1000));};media.onerror=()=>{clearTimeout(timer);reject(new Error('音频格式暂不支持'));};media.src=url;});}
  finally{media.removeAttribute('src');media.load();URL.revokeObjectURL(url);}
  if(!Number.isFinite(durationMs)||durationMs<=0||durationMs>3*60*60*1000)throw new Error('请选择三小时以内的音频');
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()));
  const id=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
  const info={id,name:file.name.slice(0,80),bytes:file.size,durationMs};await read(store=>store.put({...info,blob:file}),true);return info;
}
export async function removeAmbient(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid audio id');if(isNativeAmbient())return nativeAmbientAudio.remove({id});await read(store=>store.delete(id),true);}
let players:HTMLAudioElement[]=[],urls:string[]=[],generation=0,sourceKey='';
let context:AudioContext|undefined,master:GainNode|undefined;
let loops:AudioBufferSourceNode[]=[];
const buffers=new Map<string,Promise<AudioBuffer>>();
export async function configureAmbience(sources:string[],volume:number):Promise<void>{
  sources=normalizeAmbientSources(sources);
  if(isNativeAmbient())return nativeAmbientAudio.configure({sources,volume});
  const gain=Math.max(0,Math.min(1,volume/100))/Math.sqrt(Math.max(1,sources.length));
  if(master&&context)master.gain.setTargetAtTime(gain,context.currentTime,.04);
  players.forEach(player=>{player.volume=gain;});
  const key=sources.join(',');if(key===sourceKey)return;sourceKey=key;
  const owner=++generation;players.forEach(player=>{player.pause();player.removeAttribute('src');player.load();});players=[];urls.forEach(url=>URL.revokeObjectURL(url));urls=[];
  loops.forEach(loop=>{loop.stop();loop.disconnect();});loops=[];
  if(!sources.length)return;
  context??=new AudioContext();if(!master){master=context.createGain();master.connect(context.destination);}master.gain.value=gain;
  for(const source of sources){
    if(source==='rain'||AMBIENT_TRACKS.includes(source as AmbientTrack)){
      let buffer=buffers.get(source);if(!buffer){const decoder=context;buffer=fetch(`audio/${source}.wav`).then(response=>{if(!response.ok)throw Error('Audio unavailable');return response.arrayBuffer();}).then(bytes=>decoder.decodeAudioData(bytes));buffers.set(source,buffer);buffer.catch(()=>buffers.delete(source));}
      const decoded=await buffer;if(owner!==generation)return;
      const loop=context.createBufferSource();loop.buffer=decoded;loop.loop=true;loop.connect(master);loop.start();loops.push(loop);continue;
    }
    if(!/^[a-f0-9]{64}$/.test(source))continue;
    const item=await read(store=>store.get(source)) as AudioRecord|undefined;if(!item)continue;
    const url=URL.createObjectURL(item.blob);if(owner!==generation){URL.revokeObjectURL(url);return;}urls.push(url);
    if(owner!==generation)return;
    const player=new Audio(url);player.loop=true;player.volume=master.gain.value;players.push(player);
    await player.play().catch(()=>{/* Browser autoplay resumes on the next explicit gesture. */});
  }
}
export const resumeAmbientGesture=()=>{if(context?.state==='suspended')void context.resume().catch(()=>{});players.forEach(player=>{if(player.paused)void player.play().catch(()=>{});});};
