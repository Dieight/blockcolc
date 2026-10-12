import type { DomainState } from './model.js';

// Blueprint content is immutable after validation. Keep ownership of mutable
// business facts, without copying hundreds of thousands of unchanged voxels.
const immutableAssets = new WeakSet<object>();
const frozenNodes = new WeakSet<object>();
function freezeTree(value: unknown): void {
  if (value === null || typeof value !== 'object' || frozenNodes.has(value)) return;
  frozenNodes.add(value);
  for (const child of Object.values(value)) freezeTree(child);
  Object.freeze(value);
}
export function freezeDomainBlueprints(state: DomainState): void {
  const blueprints = [
    ...state.projects.map(project => project.importedBlueprint),
    ...state.habitBuildings.map(building => building.importedBlueprint),
    ...state.decorationBlueprintResources.map(resource => resource.blueprint),
    ...state.buildingBlueprintResources.map(resource => resource.blueprint),
  ];
  for (const blueprint of blueprints) {
    if (blueprint === null || immutableAssets.has(blueprint)) continue;
    freezeTree(blueprint);
    immutableAssets.add(blueprint);
  }
}
function copyBlueprint<T extends object | null>(blueprint: T): T {
  return blueprint !== null && immutableAssets.has(blueprint) ? blueprint : structuredClone(blueprint);
}
/** Unregistered callers retain the original complete-copy isolation contract. */
export function copyDomainState(state: DomainState): DomainState {
  const { projects, habitBuildings, decorationBlueprintResources, buildingBlueprintResources, ...facts } = state;
  return {
    ...structuredClone(facts),
    projects: projects.map(({ importedBlueprint, ...project }) => ({ ...structuredClone(project), importedBlueprint: copyBlueprint(importedBlueprint) })),
    habitBuildings: habitBuildings.map(({ importedBlueprint, ...building }) => ({ ...structuredClone(building), importedBlueprint: copyBlueprint(importedBlueprint) })),
    decorationBlueprintResources: decorationBlueprintResources.map(({ blueprint, ...resource }) => ({ ...structuredClone(resource), blueprint: copyBlueprint(blueprint) })),
    buildingBlueprintResources: buildingBlueprintResources.map(({ blueprint, ...resource }) => ({ ...structuredClone(resource), blueprint: copyBlueprint(blueprint) })),
  };
}
