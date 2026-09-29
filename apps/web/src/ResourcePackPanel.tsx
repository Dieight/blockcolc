import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileArchive, PackageCheck, Trash2 } from 'lucide-react';
import { JAVA_263_CLIENT_JAR_LIMITS, ResourcePackError, parseJava16xResourcePack } from '@blockcolc/resource-pack';
import type { ResourcePackManifest } from '@blockcolc/resource-pack';
import type { ResourcePackListItem, ResourcePackRepository } from '@blockcolc/resource-pack-indexeddb';
import { readBrowserFileBytes } from './browser-adapters';

/** The bounded picker can admit a user-owned 26.3 client JAR. The parser still
 * applies stricter ordinary-ZIP limits after inspecting the archive. */
export const RESOURCE_PACK_PICKER_MAX_BYTES = JAVA_263_CLIENT_JAR_LIMITS.maxInputBytes;

type PackListState = { status: 'idle' | 'loading' } | { status: 'ready'; packs: ResourcePackListItem[] } | { status: 'error'; message: string };

export function ResourcePackPanel({active,repository}:{active:boolean;repository:ResourcePackRepository}) {
  const [listState,setListState]=useState<PackListState>({status:'idle'});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [deleteTarget,setDeleteTarget]=useState<ResourcePackListItem|null>(null);
  const [nativePicker,setNativePicker]=useState(false);
  const cancelRef=useRef<HTMLButtonElement>(null);
  const importInFlight=useRef(false);
  const requestGeneration=useRef(0);
  const repositoryGeneration=useRef(0);
  const currentRepository=useRef(repository);
  const renderedRepository=useRef(repository);
  renderedRepository.current=repository;
  const initialReadStarted=useRef(false);
  const listStateRef=useRef<PackListState>({status:'idle'});
  const actionGeneration=useRef(0);
  const actionInFlight=useRef(false);
  const beginAction=()=>{
    if(actionInFlight.current||currentRepository.current!==repository)return null;
    actionInFlight.current=true;
    const ticket={generation:++actionGeneration.current,repository,owner:repositoryGeneration.current};
    setBusy(true);setError('');setNotice('');
    return ticket;
  };
  const actionIsCurrent=(ticket:{generation:number;repository:ResourcePackRepository;owner:number}|null)=>Boolean(ticket
    &&ticket.generation===actionGeneration.current
    &&ticket.repository===currentRepository.current
    &&ticket.repository===renderedRepository.current
    &&ticket.owner===repositoryGeneration.current);
  const finishAction=(ticket:{generation:number;repository:ResourcePackRepository;owner:number}|null)=>{
    if(!actionIsCurrent(ticket))return;
    actionInFlight.current=false;setBusy(false);
  };
  const publishListState=(next:PackListState)=>{listStateRef.current=next;setListState(next);};
  const reload=useCallback(async(targetRepository:ResourcePackRepository=repository,owner=repositoryGeneration.current)=>{
    if(owner!==repositoryGeneration.current||targetRepository!==currentRepository.current||targetRepository!==renderedRepository.current)return;
    const request=++requestGeneration.current;
    publishListState({status:'loading'});
    try{
      const value=await targetRepository.list();
      if(owner===repositoryGeneration.current&&targetRepository===currentRepository.current&&targetRepository===renderedRepository.current&&request===requestGeneration.current)publishListState({status:'ready',packs:value});
    }catch(cause){
      if(owner===repositoryGeneration.current&&targetRepository===currentRepository.current&&targetRepository===renderedRepository.current&&request===requestGeneration.current)publishListState({status:'error',message:resourcePackErrorMessage(cause)});
      throw cause;
    }
  },[repository]);
  useEffect(()=>{
    if(currentRepository.current!==repository){
      currentRepository.current=repository;
      repositoryGeneration.current+=1;
      requestGeneration.current+=1;
      actionGeneration.current+=1;
      actionInFlight.current=false;
      importInFlight.current=false;
      initialReadStarted.current=false;
      publishListState({status:'idle'});
      setBusy(false);
      setError('');setNotice('');setDeleteTarget(null);
    }
    if(!active||initialReadStarted.current)return;
    initialReadStarted.current=true;
    void reload(repository,repositoryGeneration.current).catch(()=>{});
  },[active,repository,reload]);
  useEffect(()=>{if(deleteTarget)cancelRef.current?.focus();},[deleteTarget]);
  useEffect(()=>{let active=true;void import('@blockcolc/platform-capacitor').then(platform=>{if(active)setNativePicker(platform.isCapacitorNative());}).catch(()=>{if(active)setNativePicker(false);});return()=>{active=false;};},[]);

  const importSelection=async(load:(maxBytes:number)=>Promise<{name:string;bytes:Uint8Array}|null>)=>{
    if(importInFlight.current||actionInFlight.current)return;
    const ticket=beginAction();if(!ticket)return;
    importInFlight.current=true;
    try{
      const imported=await importResourcePackFromPicker(ticket.repository,load);
      if(!imported)return;
      await reload(ticket.repository,ticket.owner);
      if(actionIsCurrent(ticket))setNotice(`已导入并启用：识别 ${imported.textures.length} 张方块纹理、${imported.blockStates.length} 个方块状态和 ${imported.models.length} 个模型。`);
    }catch(cause){if(actionIsCurrent(ticket))setError(resourcePackErrorMessage(cause));}
    finally{if(actionIsCurrent(ticket))importInFlight.current=false;finishAction(ticket);}
  };
  const importBrowserPack=(file:File|undefined)=>file?importSelection(async maxBytes=>({name:file.name,bytes:await readBrowserFileBytes(file,maxBytes)})):Promise.resolve();
  const importNativePack=()=>importSelection(async maxBytes=>{
    const platform=await import('@blockcolc/platform-capacitor');
    const selected=await platform.pickNativeResourcePackFile(maxBytes);
    return selected?{name:selected.name,bytes:selected.bytes}:null;
  });
  const select=async(id:string|null)=>{
    if(listStateRef.current.status!=='ready'||(id!==null&&!listStateRef.current.packs.some(pack=>pack.id===id)))return;
    const ticket=beginAction();if(!ticket)return;
    try{if(id===null){await ticket.repository.select(null);await ticket.repository.selectBase(null);}else await ticket.repository.select(id);await reload(ticket.repository,ticket.owner);if(actionIsCurrent(ticket))setNotice(id===null?'已切回方块钟原创材质。':'已切换外观资源包；缺失资源仍可由基础包补全。');}
    catch(cause){if(actionIsCurrent(ticket))setError(resourcePackErrorMessage(cause));}
    finally{finishAction(ticket);}
  };
  const selectBase=async(id:string|null)=>{
    if(listStateRef.current.status!=='ready'||(id!==null&&!listStateRef.current.packs.some(pack=>pack.id===id)))return;
    const ticket=beginAction();if(!ticket)return;
    try{await ticket.repository.selectBase(id);await reload(ticket.repository,ticket.owner);if(actionIsCurrent(ticket))setNotice(id===null?'已关闭基础资源包。':'已设置基础资源包，将补全当前外观包缺失的资源。');}
    catch(cause){if(actionIsCurrent(ticket))setError(resourcePackErrorMessage(cause));}
    finally{finishAction(ticket);}
  };
  const remove=async()=>{
    if(!deleteTarget||listStateRef.current.status!=='ready'||!listStateRef.current.packs.some(pack=>pack.id===deleteTarget.id))return;
    const ticket=beginAction();if(!ticket)return;
    try{const wasSelected=deleteTarget.active||deleteTarget.base;await ticket.repository.delete(deleteTarget.id);if(actionIsCurrent(ticket))setDeleteTarget(null);await reload(ticket.repository,ticket.owner);if(actionIsCurrent(ticket))setNotice(wasSelected?'已删除资源包；相关外观或基础层已自动取消。':'已删除资源包。');}
    catch(cause){if(actionIsCurrent(ticket))setError(resourcePackErrorMessage(cause));}
    finally{finishAction(ticket);}
  };
  const visibleListState=currentRepository.current===repository?listState:{status:'idle'} as PackListState;
  const packs=visibleListState.status==='ready'?visibleListState.packs:[];
  const originalActive=visibleListState.status==='ready'&&!packs.some(pack=>pack.active||pack.base);

  return <section className="resource-pack-panel" aria-labelledby="resource-pack-title">
    <header><h2 id="resource-pack-title">方块材质包</h2><p>可导入资源包 ZIP 或 Java 26.3 客户端 JAR；外观优先，基础包补缺，只改变画面。</p></header>
    {visibleListState.status==='ready'&&<div className={originalActive?'resource-pack-original active':'resource-pack-original'}><div><b>方块钟原创材质</b><small>{originalActive?'正在使用':'安全回退外观'}</small></div><button type="button" disabled={busy||originalActive} onClick={()=>void select(null)}>{originalActive?<PackageCheck/>:null}{originalActive?'使用中':'使用'}</button></div>}
    {visibleListState.status==='idle'&&<p className="resource-pack-list-status" role="status">尚未读取本机资源包。</p>}
    {visibleListState.status==='loading'&&<p className="resource-pack-list-status" role="status" aria-busy="true">正在读取本机资源包…</p>}
    {visibleListState.status==='error'&&<div className="resource-pack-list-error" role="alert"><p>无法读取本机资源包：{visibleListState.message}</p><button type="button" disabled={busy} onClick={()=>void reload().catch(()=>{})}>重试</button></div>}
    {nativePicker?<button className="resource-pack-import" type="button" disabled={busy} onClick={()=>void importNativePack()}><FileArchive/><span>{busy?'正在处理...':'导入 Java 资源包 ZIP / JAR'}</span></button>:<label className="resource-pack-import"><FileArchive/><span>{busy?'正在处理...':'导入 Java 资源包 ZIP / JAR'}</span><input aria-label="导入 Java 资源包 ZIP / JAR" type="file" accept=".zip,.jar,application/zip,application/x-zip-compressed,application/java-archive" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.currentTarget.value='';void importBrowserPack(file);}}/></label>}
    <p className="resource-pack-license">资源需自备且有权使用；方块钟不内置或上传，JSON 备份不含资源包。未适配部分回退原创材质。</p>
    {error&&<p className="backup-error" role="alert"><AlertTriangle/>{error}</p>}{notice&&<p className="backup-notice" role="status">{notice}</p>}
    {visibleListState.status==='ready'&&packs.length===0&&<p className="resource-pack-list-status" role="status">本机尚无导入的资源包。</p>}
    {visibleListState.status==='ready'&&packs.length>0&&<ul className="resource-pack-list">{packs.map(pack=><li className={pack.active||pack.base?'active':''} key={pack.id}><div><strong>{pack.name}</strong><span>pack_format {pack.packFormat} · {pack.textureCount} 张纹理 · {formatBytes(pack.archiveBytes)}</span>{(pack.active||pack.base)&&<small>{[pack.active?'外观层':null,pack.base?'基础层':null].filter(Boolean).join(' · ')}</small>}</div><div><button type="button" disabled={busy||pack.active} onClick={()=>void select(pack.id)}>{pack.active?'使用中':'使用'}</button><button type="button" disabled={busy} onClick={()=>void selectBase(pack.base?null:pack.id)}>{pack.base?'取消基础':'设为基础'}</button><button className="resource-pack-delete" type="button" aria-label={`删除“${pack.name}”`} disabled={busy} onClick={()=>setDeleteTarget(pack)}><Trash2/></button></div></li>)}</ul>}
    {deleteTarget&&visibleListState.status==='ready'&&<div className="dialog-backdrop" role="presentation"><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="resource-pack-delete-title"><h2 id="resource-pack-delete-title">删除这个资源包？</h2><p>{deleteTarget.active&&!packs.some(pack=>pack.base&&pack.id!==deleteTarget.id)?'删除后会立即回退到方块钟原创材质。':deleteTarget.active||deleteTarget.base?'删除后会取消这个资源包的外观或基础层；其他已选资源包仍保留。':'只删除本机保存的资源包，不影响任务与蓝图。'}</p><div className="dialog-actions"><button ref={cancelRef} disabled={busy} onClick={()=>setDeleteTarget(null)}>取消</button><button className="danger-action" disabled={busy} onClick={()=>void remove()}><Trash2/>删除资源包</button></div></div></div>}
  </section>;
}

export async function importResourcePackFromPicker(
  repository:ResourcePackRepository,
  pick:(maxBytes:number)=>Promise<{name:string;bytes:Uint8Array}|null>,
  now:()=>Date=()=>new Date(),
):Promise<ResourcePackManifest|null>{
  const selected=await pick(RESOURCE_PACK_PICKER_MAX_BYTES);
  if(!selected)return null;
  const archive=selected.bytes;
  const manifest=parseJava16xResourcePack(archive);
  const id=await contentId(archive);
  await repository.save({id,name:displayName(selected.name),importedAt:now().toISOString(),archive,manifest});
  await repository.select(id);
  return manifest;
}

async function contentId(bytes:Uint8Array):Promise<string>{const digest=await crypto.subtle.digest('SHA-256',bytes.slice().buffer);return `sha256:${[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')}`;}
function displayName(fileName:string):string{return fileName.replace(/\.(?:zip|jar)$/i,'').trim().slice(0,160)||'未命名资源包';}
function formatBytes(value:number):string{return value<1024?`${value} B`:value<1024*1024?`${Math.round(value/1024)} KB`:`${(value/1024/1024).toFixed(1)} MB`;}
function resourcePackErrorMessage(cause:unknown):string{if(cause instanceof ResourcePackError){if(cause.code==='INPUT_TOO_LARGE')return'资源包超过当前格式的导入上限（普通 ZIP 32 MB，26.3 客户端 JAR 64 MB）。';if(cause.code==='FILE_TOO_LARGE')return'资源包中有单个文件超过 4 MB 安全上限。';if(cause.code==='TOTAL_UNCOMPRESSED_TOO_LARGE')return'资源包展开后超过 64 MB 安全上限。';if(cause.code==='TOO_MANY_FILES')return'资源包文件数超过当前格式的安全上限。';if(cause.code==='MISSING_PACK_MCMETA'||cause.code==='INVALID_PACK_MCMETA')return'资源包缺少有效的 pack.mcmeta；客户端 JAR 还需为 Java 26.3。';if(cause.code==='UNSAFE_PATH'||cause.code==='DUPLICATE_PATH'||cause.code==='CASE_COLLISION'||cause.code==='ENCRYPTED_ENTRY')return'资源包包含不安全、重复、大小写冲突或加密的文件路径。';return'无法解析这个 Java 资源包。';}return cause instanceof Error?cause.message:'资源包操作失败，请重试。';}
