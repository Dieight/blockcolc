import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileArchive, PackageCheck, Trash2 } from 'lucide-react';
import { DEFAULT_RESOURCE_PACK_LIMITS, ResourcePackError, parseJava16xResourcePack } from '@tomato-clock/resource-pack';
import type { ResourcePackManifest } from '@tomato-clock/resource-pack';
import type { ResourcePackListItem, ResourcePackRepository } from '@tomato-clock/resource-pack-indexeddb';
import { readBrowserFileBytes } from './browser-adapters';

export function ResourcePackPanel({repository}:{repository:ResourcePackRepository}) {
  const [packs,setPacks]=useState<ResourcePackListItem[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [deleteTarget,setDeleteTarget]=useState<ResourcePackListItem|null>(null);
  const [nativePicker,setNativePicker]=useState(false);
  const cancelRef=useRef<HTMLButtonElement>(null);
  const importInFlight=useRef(false);
  const reload=useCallback(async()=>setPacks(await repository.list()),[repository]);
  useEffect(()=>{let active=true;void repository.list().then(value=>{if(active)setPacks(value);}).catch(cause=>{if(active)setError(resourcePackErrorMessage(cause));});return()=>{active=false;};},[repository]);
  useEffect(()=>{if(deleteTarget)cancelRef.current?.focus();},[deleteTarget]);
  useEffect(()=>{let active=true;void import('@tomato-clock/platform-capacitor').then(platform=>{if(active)setNativePicker(platform.isCapacitorNative());}).catch(()=>{if(active)setNativePicker(false);});return()=>{active=false;};},[]);

  const importSelection=async(load:(maxBytes:number)=>Promise<{name:string;bytes:Uint8Array}|null>)=>{
    if(importInFlight.current)return;
    importInFlight.current=true;
    setBusy(true);setError('');setNotice('');
    try{
      const imported=await importResourcePackFromPicker(repository,load);
      if(!imported)return;
      await reload();
      setNotice(`已导入并启用：识别 ${imported.textures.length} 张 16x 方块纹理、${imported.blockStates.length} 个方块状态和 ${imported.models.length} 个模型。`);
    }catch(cause){setError(resourcePackErrorMessage(cause));}
    finally{importInFlight.current=false;setBusy(false);}
  };
  const importBrowserPack=(file:File|undefined)=>file?importSelection(async maxBytes=>({name:file.name,bytes:await readBrowserFileBytes(file,maxBytes)})):Promise.resolve();
  const importNativePack=()=>importSelection(async maxBytes=>{
    const platform=await import('@tomato-clock/platform-capacitor');
    const selected=await platform.pickNativeResourcePackFile(maxBytes);
    return selected?{name:selected.name,bytes:selected.bytes}:null;
  });
  const select=async(id:string|null)=>{setBusy(true);setError('');setNotice('');try{await repository.select(id);await reload();setNotice(id===null?'已切回方块钟原创材质。':'已切换资源包，将用于兼容的导入建筑。');}catch(cause){setError(resourcePackErrorMessage(cause));}finally{setBusy(false);}};
  const remove=async()=>{if(!deleteTarget)return;setBusy(true);setError('');setNotice('');try{const wasActive=deleteTarget.active;await repository.delete(deleteTarget.id);setDeleteTarget(null);await reload();setNotice(wasActive?'已删除资源包并回退到原创材质。':'已删除资源包。');}catch(cause){setError(resourcePackErrorMessage(cause));}finally{setBusy(false);}};
  const originalActive=!packs.some(pack=>pack.active);

  return <section className="resource-pack-panel" aria-labelledby="resource-pack-title">
    <header><h2 id="resource-pack-title">方块材质包</h2><p>支持 16x 纹理与常用模型；只改变显示，不修改任务和进度。</p></header>
    <div className={originalActive?'resource-pack-original active':'resource-pack-original'}><div><b>方块钟原创材质</b><small>{originalActive?'正在使用':'安全回退外观'}</small></div><button type="button" disabled={busy||originalActive} onClick={()=>void select(null)}>{originalActive?<PackageCheck/>:null}{originalActive?'使用中':'使用'}</button></div>
    {nativePicker?<button className="resource-pack-import" type="button" disabled={busy} onClick={()=>void importNativePack()}><FileArchive/><span>{busy?'正在处理...':'导入 Java 资源包 ZIP'}</span></button>:<label className="resource-pack-import"><FileArchive/><span>{busy?'正在处理...':'导入 Java 资源包 ZIP'}</span><input aria-label="导入 Java 资源包 ZIP" type="file" accept=".zip,application/zip,application/x-zip-compressed" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.currentTarget.value='';void importBrowserPack(file);}}/></label>}
    <p className="resource-pack-license">资源版权归原作者，请只导入你有权使用的资源包。任务 JSON 备份不包含资源包文件，未兼容的模型会使用原创材质安全回退。</p>
    {error&&<p className="backup-error" role="alert"><AlertTriangle/>{error}</p>}{notice&&<p className="backup-notice" role="status">{notice}</p>}
    {packs.length>0&&<ul className="resource-pack-list">{packs.map(pack=><li className={pack.active?'active':''} key={pack.id}><div><strong>{pack.name}</strong><span>pack_format {pack.packFormat} · {pack.textureCount} 张纹理 · {formatBytes(pack.archiveBytes)}</span><small>{pack.namespaces.length?pack.namespaces.join(', '):'无可用 namespace'}</small></div><div><button type="button" disabled={busy||pack.active} onClick={()=>void select(pack.id)}>{pack.active?'使用中':'使用'}</button><button className="resource-pack-delete" type="button" aria-label={`删除“${pack.name}”`} disabled={busy} onClick={()=>setDeleteTarget(pack)}><Trash2/></button></div></li>)}</ul>}
    {deleteTarget&&<div className="dialog-backdrop" role="presentation"><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="resource-pack-delete-title"><h2 id="resource-pack-delete-title">删除这个资源包？</h2><p>{deleteTarget.active?'删除后会立即回退到方块钟原创材质。':'只删除本机保存的资源包，不影响任务与蓝图。'}</p><div className="dialog-actions"><button ref={cancelRef} disabled={busy} onClick={()=>setDeleteTarget(null)}>取消</button><button className="danger-action" disabled={busy} onClick={()=>void remove()}><Trash2/>删除资源包</button></div></div></div>}
  </section>;
}

export async function importResourcePackFromPicker(
  repository:ResourcePackRepository,
  pick:(maxBytes:number)=>Promise<{name:string;bytes:Uint8Array}|null>,
  now:()=>Date=()=>new Date(),
):Promise<ResourcePackManifest|null>{
  const selected=await pick(DEFAULT_RESOURCE_PACK_LIMITS.maxInputBytes);
  if(!selected)return null;
  const archive=selected.bytes;
  const manifest=parseJava16xResourcePack(archive);
  const id=await contentId(archive);
  await repository.save({id,name:displayName(selected.name),importedAt:now().toISOString(),archive,manifest});
  await repository.select(id);
  return manifest;
}

async function contentId(bytes:Uint8Array):Promise<string>{const digest=await crypto.subtle.digest('SHA-256',bytes.slice().buffer);return `sha256:${[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')}`;}
function displayName(fileName:string):string{return fileName.replace(/\.zip$/i,'').trim().slice(0,160)||'未命名资源包';}
function formatBytes(value:number):string{return value<1024?`${value} B`:value<1024*1024?`${Math.round(value/1024)} KB`:`${(value/1024/1024).toFixed(1)} MB`;}
function resourcePackErrorMessage(cause:unknown):string{if(cause instanceof ResourcePackError){if(cause.code==='INPUT_TOO_LARGE')return'资源包 ZIP 超过 32 MB 导入上限。';if(cause.code==='FILE_TOO_LARGE')return'资源包中有单个文件超过 4 MB 安全上限。';if(cause.code==='TOTAL_UNCOMPRESSED_TOO_LARGE')return'资源包展开后超过 64 MB 安全上限。';if(cause.code==='TOO_MANY_FILES')return'资源包文件数超过 8,192 个安全上限。';if(cause.code==='MISSING_PACK_MCMETA'||cause.code==='INVALID_PACK_MCMETA')return'资源包根目录缺少有效的 pack.mcmeta。';if(cause.code==='UNSAFE_PATH'||cause.code==='DUPLICATE_PATH'||cause.code==='CASE_COLLISION'||cause.code==='ENCRYPTED_ENTRY')return'资源包包含不安全、重复、大小写冲突或加密的文件路径。';return'无法解析这个 Java 资源包 ZIP。';}return cause instanceof Error?cause.message:'资源包操作失败，请重试。';}
