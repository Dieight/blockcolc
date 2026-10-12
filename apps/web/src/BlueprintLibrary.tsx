import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ApplicationCommand } from '@blockcolc/application';
import { holidaysForYear, MAX_BUILDING_BLUEPRINTS, type DomainState, type ImportedBlueprintV1 } from '@blockcolc/domain';
import type { BlueprintV1, BlueprintCatalogEntry } from '@blockcolc/voxel';
import type { ResourcePackRepository } from '@blockcolc/resource-pack-indexeddb';
import { t, useI18n } from './i18n';
import { loadVoxelModule } from './voxel-runtime';
import { BlueprintPreview, type BlueprintPreviewSource } from './BlueprintPreview';
import { PixelChevron, PixelClose, PixelCube, PixelEdit, PixelCheck, PixelPlus } from './ui/PixelIcon';
import { Reveal } from './ui/Reveal';
import { useBackLayer } from './back-layer';
import { LITEMATIC_MAX_COMPRESSED_BYTES, readBrowserFileBytes } from './browser-adapters';
import { LOCAL_BUILTIN_SOURCES } from '@blockcolc/voxel/local-blueprint-sources';
import { localBlueprintTitle } from './builtin-blueprint-labels';
import { NativeImeTextEntry } from './NativeImeTextEntry';

const rewardMetadata = new Map(Object.values(LOCAL_BUILTIN_SOURCES).filter(item=>item.category==='daily-reward').map(item=>[item.id,item]));

interface Entry extends Partial<BlueprintPreviewSource> { id: string; displayName: string; description: string; locked?: boolean; imported?: boolean }
type Run = (command: ApplicationCommand) => Promise<unknown>;
const saved = (result: unknown) => Boolean(result && typeof result === 'object' && 'ok' in result && result.ok === true);

/** Import, preview and management share one catalogue and one modal owner. */
export function BlueprintLibrary({ state, resourcePacks, run }: { state: DomainState; resourcePacks: ResourcePackRepository; run: Run }) {
  const language = useI18n();
  const [open, setOpen] = useState(false), [catalog, setCatalog] = useState<readonly BlueprintCatalogEntry[]>([]);
  const [preview, setPreview] = useState<Entry | null>(null), [candidate, setCandidate] = useState<BlueprintV1 | null>(null);
  const [role, setRole] = useState<'building' | 'decoration'>('building'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [remove, setRemove] = useState<string | null>(null), [renaming, setRenaming] = useState<string | null>(null), [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null), closeButton = useRef<HTMLButtonElement>(null), opener = useRef<HTMLElement | null>(null), sheet = useRef<HTMLElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const lane = useRef(false);
  const close = () => { if (lane.current) return; setPreview(null); setCandidate(null); setRemove(null); setError(''); opener.current?.focus({ preventScroll: true }); };
  useBackLayer(Boolean(preview || candidate || remove), () => { close(); return true; });
  useEffect(() => {
    if (!preview && !candidate && !remove) return;
    closeButton.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const targets = [...sheet.current!.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href],[tabindex="0"]')];
      const first=targets[0],last=targets.at(-1);if(!first||!last)return;
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus({preventScroll:true});}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus({preventScroll:true});}
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [preview, candidate, remove]);
  useEffect(() => {
    if (!open || catalog.length) return;
    let live = true;
    void loadVoxelModule().then(module => { if (live) setCatalog(module.BUILTIN_BLUEPRINT_CATALOG); }).catch(() => { if (live) setError('蓝图库暂不可用，请稍后重试'); });
    return () => { live = false; };
  }, [open, catalog.length]);
  const groups = useMemo(() => {
    const unlocked = new Set(state.holidayRewards.map(reward => reward.holidayId));
    const known = catalog.map(entry => ({ ...entry, displayName: t(entry.displayName), description: t(entry.description) }));
    return [
      { name: t('原生图纸'), entries: known.filter(entry => !entry.id.startsWith('builtin-local-')) },
      { name: t('补充图纸'), entries: known.filter(entry => entry.id.startsWith('builtin-local-')) },
      { name: t('自添加图纸'), entries: state.buildingBlueprintResources.map(resource => ({ id: resource.id, displayName: resource.displayName, blueprint: resource.blueprint as BlueprintV1, description: t('本机导入的建筑图纸'), imported: true })) },
      { name: t('每日奖励'), entries: state.decorationBlueprintResources.map(resource => ({ id: resource.id, displayName: localBlueprintTitle(resource.id,resource.blueprint.title), blueprint: resource.blueprint as BlueprintV1, description: t(rewardMetadata.get(resource.id)?.description ?? '完成每日目标可获得') })) },
      { name: t('节日奖励'), entries: holidaysForYear(new Date().getFullYear()).map(holiday => ({ id: holiday.id, displayName: unlocked.has(holiday.id) ? t(holiday.buildingName) : '???', locked: !unlocked.has(holiday.id), description: unlocked.has(holiday.id) ? t(holiday.description) : t('也许在某些特定节日启动方块钟会发现它') })) },
    ] as { name: string; entries: Entry[] }[];
  }, [catalog, state.buildingBlueprintResources, state.decorationBlueprintResources, state.holidayRewards, language]);
  const perform = async (operation: () => Promise<void>) => {
    if (lane.current) return;
    lane.current = true; setBusy(true); setError('');
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存这份蓝图。'); }
    finally { lane.current = false; setBusy(false); }
  };
  const show = async (entry: Entry, target: HTMLElement) => {
    opener.current = target; setError('');
    if (entry.locked || entry.blueprint) { setPreview(entry); return; }
    await perform(async () => { const { holidayBuildingBlueprint } = await import('@blockcolc/voxel/holiday-buildings'); setPreview({ ...entry, blueprint: holidayBuildingBlueprint(entry.id, entry.displayName) }); });
  };
  const importFile = () => perform(async () => {
    const platform = await import('@blockcolc/platform-capacitor');
    if (!platform.isCapacitorNative()) { input.current?.click(); return; }
    const file = await platform.pickNativeLitematicFile(LITEMATIC_MAX_COMPRESSED_BYTES);
    if (file) await parse(file.bytes);
  });
  const parse = async (bytes: Uint8Array) => { const { parseLitematic } = await import('@blockcolc/litematic'); const result = await parseLitematic(bytes); setRole('building'); setCandidate(result.blueprint); };
  const save = () => perform(async () => {
    if (!candidate) return;
    if (role === 'building' && state.buildingBlueprintResources.length >= MAX_BUILDING_BLUEPRINTS) throw new Error(t('最多保存 {0} 份，请先删除一份。', MAX_BUILDING_BLUEPRINTS));
    const b = candidate.bounds;
    if (role === 'decoration' && (b.maxX-b.minX+1 > 12 || b.maxZ-b.minZ+1 > 12 || b.maxY-b.minY+1 > 16 || candidate.voxels.length > 2000)) throw new Error(t('奖励装饰上限 12 × 12 × 16、2,000 个方块。'));
    const blueprint: ImportedBlueprintV1 = { ...candidate, voxels: candidate.voxels.map(voxel => ({ ...voxel, stage: voxel.buildOrder < 1800 ? 'foundation' : voxel.buildOrder < 3800 ? 'frame' : voxel.buildOrder < 6500 ? 'walls' : voxel.buildOrder < 8800 ? 'roof' : 'details' })) };
    if (!saved(await run({ type: role === 'building' ? 'ImportBuildingBlueprint' : 'ImportDecorationBlueprint', blueprint }))) throw new Error(t('无法保存这份蓝图。'));
    setCandidate(null);
  });
  const rename = () => {
    const displayName = (renameInput.current?.value ?? name).trim();
    return perform(async () => { if (!renaming || !displayName) throw new Error(t('蓝图名称不能为空。')); if (!saved(await run({ type: 'RenameBuildingBlueprint', blueprintId: renaming, displayName }))) throw new Error(t('无法修改蓝图名称。')); setRenaming(null); });
  };
  const modal = preview || candidate || remove;
  return <section className="settings-group blueprint-library" aria-label={t('蓝图库')}>
    <h2>{t('蓝图库')}</h2><div className="settings-list">
      <button type="button" className="setting-row library-heading" aria-expanded={open} onClick={() => setOpen(value => !value)}><span className="setting-name"><span>{t('所有图纸')}</span><small>{t('原生、导入与建造奖励')}</small></span><PixelChevron/></button>
      <Reveal open={open}><div className="library-groups">
        <div className="library-toolbar"><button type="button" className="settings-text-action" disabled={busy} aria-busy={busy} onClick={() => { opener.current = document.activeElement as HTMLElement; void importFile(); }}><PixelPlus/>{t('导入 .litematic')}</button><small>{state.buildingBlueprintResources.length}/{MAX_BUILDING_BLUEPRINTS}</small></div>
        <input ref={input} aria-label={t('导入 .litematic')} className="sr-only" type="file" accept=".litematic,application/octet-stream" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void perform(async () => parse(await readBrowserFileBytes(file))); }}/>
        {groups.map(group => <details key={group.name}><summary>{group.name}<span>{group.entries.length}</span><PixelChevron/></summary><ul className="library-tiles">{group.entries.map(entry => <li key={entry.id}>
          {renaming === entry.id ? <form className="library-rename" onSubmit={event => { event.preventDefault(); void rename(); }}><NativeImeTextEntry targetRef={renameInput} name="blueprintName" ariaLabel={t('蓝图名称')} maxLength={80} defaultValue={name} autoFocus disabled={busy}/><button type="submit" aria-label={t('保存蓝图名称')} disabled={busy}><PixelCheck/></button><button type="button" aria-label={t('取消重命名')} onClick={() => setRenaming(null)}><PixelClose/></button></form>
          : <><button type="button" className="library-preview-action" disabled={busy} onClick={event => void show(entry, event.currentTarget)}><span className="library-miniature">{entry.locked ? '?' : <PixelCube/>}</span><span><strong>{entry.displayName}</strong><small>{entry.locked ? t('待发现') : entry.description}</small></span></button>{entry.imported && <div className="blueprint-library-actions"><button type="button" className="settings-text-action blueprint-rename" aria-label={t('重命名“{0}”', entry.displayName)} disabled={busy} onClick={() => { setName(entry.displayName); setRenaming(entry.id); }}><PixelEdit/></button><button type="button" className="settings-text-action blueprint-delete" aria-label={t('删除“{0}”',entry.displayName)} disabled={busy} onClick={event => { opener.current = event.currentTarget; setRemove(entry.id); }}>{t('删除')}</button></div>}</>}
        </li>)}</ul></details>)}
      </div></Reveal>
      {error && !modal && <p className="import-error" role="alert">{t(error)}</p>}
    </div>
    {modal && createPortal(<div className="dialog-backdrop edge-sheet-backdrop library-preview-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}><section ref={sheet} className="confirm-dialog library-preview-dialog" role="dialog" aria-modal="true" aria-label={remove ? t('从蓝图库删除？') : t('蓝图预览')}>
      <button ref={closeButton} type="button" className="dialog-close" aria-label={t('关闭蓝图预览')} disabled={busy} onClick={close}><PixelClose/></button>
      <h2>{remove ? t('从蓝图库删除？') : candidate?.title ?? preview?.displayName}</h2>
      {remove ? <><p>{t('不会改变使用这份蓝图创建的已有大型任务。')}</p><button type="button" className="danger-action" disabled={busy} aria-busy={busy} onClick={() => void perform(async () => { if (!saved(await run({ type:'DeleteBuildingBlueprint',blueprintId:remove }))) throw new Error(t('无法保存这份蓝图。')); setRemove(null); })}>{t('删除蓝图')}</button></>
      : candidate ? <><BlueprintPreview resourcePacks={resourcePacks} source={{id:candidate.id,displayName:candidate.title,blueprint:candidate}}/><div className="import-role" role="group" aria-label={t('导入蓝图用途')}><button type="button" aria-pressed={role==='building'} onClick={()=>setRole('building')}>{t('大型任务建筑')}</button><button type="button" aria-pressed={role==='decoration'} onClick={()=>setRole('decoration')}>{t('每日奖励装饰')}</button></div><div className="dialog-actions"><button type="button" disabled={busy} onClick={close}>{t('取消')}</button><button type="button" className="primary" disabled={busy} aria-busy={busy} onClick={()=>void save()}>{role==='building'?t('保存到建筑蓝图库'):t('加入每日奖励装饰池')}</button></div></>
      : preview?.locked ? <div className="blueprint-mystery" role="img" aria-label={t('尚未发现的节日建筑')}><svg viewBox="0 0 9 12" shapeRendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2 0h5v1h1v1h1v3H8v1H6v1H5v1H3V6h1V5h2V4h1V2H2v2H0V2h1V1h1zM3 10h2v2H3z"/></svg></div>
      : preview?.blueprint && <BlueprintPreview resourcePacks={resourcePacks} source={{id:preview.id,displayName:preview.displayName,blueprint:preview.blueprint}}/>}
      {preview && <p>{preview.description}</p>}{error && <p className="import-error" role="alert">{t(error)}</p>}
    </section></div>, document.body)}
  </section>;
}
