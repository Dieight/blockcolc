import { useState } from 'react';
import type { ApplicationCommand, ApplicationResult, ApplicationService } from '@tomato-clock/application';
import type { BlueprintCatalogEntry, BlueprintV1 } from '@tomato-clock/voxel';
import type { ResourcePackRepository } from '@tomato-clock/resource-pack-indexeddb';
import { Hammer } from 'lucide-react';
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
  const selected = options.find((option) => option.id === selectedId) ?? options[0];
  const completedCount = state.habitBuildings.filter((building) => building.habitProjectId === active.project.id).length;
  const choose = async () => {
    if (!selected || pending) return;
    setPending(true);
    try {
      await run({
        type: 'SelectNextHabitBuilding',
        blueprintId: selected.id,
        importedBlueprint: shouldPersistBlueprintSnapshot(selected.blueprint.id) ? toImportedBlueprint(selected.blueprint) : null,
        targetRounds,
      });
    } finally {
      setPending(false);
    }
  };
  if (!selected) return <div className="blueprint-loading" role="status">正在准备建筑预览...</div>;
  return <div className="habit-building-selection">
    <div className="habit-selection-heading"><span className="eyebrow">上一座已完成</span><h2>选择第 {active.project.habit!.cycleNumber} 座建筑</h2><p>已留下 {completedCount} 座建筑；下一座需要 {targetRounds} 轮专注。确认后，本周期内不能更换。</p></div>
    <BlueprintPicker resourcePacks={resourcePacks} options={options} selected={selected} onSelect={setSelectedId}/>
    <button type="button" className="primary habit-building-confirm" disabled={pending} onClick={() => void choose()}><Hammer/>{pending ? '正在确定...' : '开始建造这座建筑'}</button>
  </div>;
}
