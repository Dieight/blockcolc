import { useRef, useState } from 'react';
import type { ApplicationCommand, ApplicationResult, ApplicationService } from '@blockcolc/application';
import type { BlueprintCatalogEntry, BlueprintV1 } from '@blockcolc/voxel';
import type { ResourcePackRepository } from '@blockcolc/resource-pack-indexeddb';
import { PixelHammer as Hammer } from './ui/PixelIcon';
import { useBlueprintCatalog } from './voxel-runtime';
import { BlueprintPicker } from './BlueprintPicker';
import { shouldPersistBlueprintSnapshot, toImportedBlueprint } from './blueprint-adapter';

export function HabitBuildingSelection({ state, active, resourcePacks, run, targetRounds }: {
  state: ReturnType<ApplicationService['snapshot']>;
  active: NonNullable<ReturnType<ApplicationService['activeProjectProjection']>>;
  resourcePacks: ResourcePackRepository;
  run: (command: ApplicationCommand) => Promise<ApplicationResult>;
  targetRounds: number;
}) {
  const catalog = useBlueprintCatalog();
  const libraryEntries: BlueprintCatalogEntry[] = state.buildingBlueprintResources.map((resource) => ({
    id: resource.id,
    displayName: resource.displayName,
    description: `本地建筑蓝图 · ${new Date(resource.importedAt).toLocaleDateString('zh-CN')} 导入`,
    footprint: { width: resource.blueprint.bounds.maxX - resource.blueprint.bounds.minX + 1, depth: resource.blueprint.bounds.maxZ - resource.blueprint.bounds.minZ + 1 },
    complexity: resource.blueprint.voxels.length > 3000 ? 'detailed' : 'moderate',
    blueprint: resource.blueprint as BlueprintV1,
  }));
  const options = [...catalog, ...libraryEntries];
  const [selectedId, setSelectedId] = useState<string>('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const selected = options.find((option) => option.id === selectedId) ?? options[0];
  const completedCount = state.habitBuildings.filter((building) => building.habitProjectId === active.project.id).length;
  const choose = async () => {
    if (!selected || busy.current) return;
    busy.current = true; setPending(true);
    try {
      await run({
        type: 'SelectNextHabitBuilding',
        blueprintId: selected.id,
        importedBlueprint: shouldPersistBlueprintSnapshot(selected.blueprint.id) ? toImportedBlueprint(selected.blueprint) : null,
        targetRounds,
      });
    } catch { /* The command runner reports the failure, keeping this selection. */ }
    finally {
      busy.current = false;
      setPending(false);
    }
  };
  if (!selected) return <div className="blueprint-loading" role="status">正在准备建筑预览...</div>;
  return <div className="habit-building-selection">
    <div className="habit-selection-heading"><span className="eyebrow">上一座已完成</span><h2>选择第 {active.project.habit!.cycleNumber} 座建筑</h2><p>已留下 {completedCount} 座建筑；下一座需要 {targetRounds} 轮专注。确认后，本周期内不能更换。</p></div>
    <BlueprintPicker resourcePacks={resourcePacks} options={options} selected={selected} onSelect={setSelectedId}/>
    <button type="button" className="primary habit-building-confirm" disabled={pending} aria-busy={pending} onClick={() => void choose()}><Hammer/>{pending ? '正在确定...' : '开始建造这座建筑'}</button>
  </div>;
}
