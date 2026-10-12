import { t, useI18n } from './i18n';
import type { ReactNode } from 'react';
import type { BlueprintCatalogEntry } from '@blockcolc/voxel';
import type { ResourcePackRepository } from '@blockcolc/resource-pack-indexeddb';
import { PixelCheck as Check } from './ui/PixelIcon';
import { BlueprintPreview } from './BlueprintPreview';

function complexityLabel(value:BlueprintCatalogEntry['complexity']) { return value==='simple'?t("紧凑"):value==='moderate'?t("适中"):t("丰富"); }

export function BlueprintPicker({resourcePacks,options,selected,onSelect,importControl}:{resourcePacks:ResourcePackRepository;options:readonly BlueprintCatalogEntry[];selected:BlueprintCatalogEntry;onSelect:(id:string)=>void;importControl?:ReactNode}) {
  useI18n();
  return <fieldset className="blueprint-picker"><legend>{t("选择建筑蓝图")}</legend><BlueprintPreview resourcePacks={resourcePacks} source={selected}/><div className="blueprint-options">{options.map(option=><label className={option.id===selected.id?'blueprint-option selected':'blueprint-option'} key={option.id}><input type="radio" name="blueprint" value={option.id} checked={option.id===selected.id} onChange={()=>onSelect(option.id)}/><span className="blueprint-option-copy"><strong>{option.id.startsWith('builtin-')?t(option.displayName):option.displayName}</strong><small>{option.footprint.width} x {option.footprint.depth} {t("方块 ·")}{' '}{complexityLabel(option.complexity)}</small></span>{option.id===selected.id&&<Check aria-hidden="true"/>}</label>)}</div><p className="blueprint-description">{selected.id.startsWith('builtin-')?t(selected.description):selected.description}</p><p className="blueprint-lock">{t("蓝图在创建后不可更换，请确认完整预览。")}</p>{importControl}</fieldset>;
}
