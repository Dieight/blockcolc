import type { ApplicationCommand, ApplicationResult, ApplicationService } from '@tomato-clock/application';
import type { BlueprintV1 } from '@tomato-clock/voxel';
import { toImportedBlueprint } from './blueprint-adapter';

const MAX_DECORATION_WIDTH = 12;
const MAX_DECORATION_DEPTH = 12;
const MAX_DECORATION_HEIGHT = 16;
const MAX_DECORATION_VOXELS = 2_000;

type DecorationImportCommand = Extract<ApplicationCommand, { type: 'ImportDecorationBlueprint' }>;

export interface BuiltinDailyRewardRegistration {
  /** Number of packaged candidates examined, including candidates rejected locally. */
  examined: number;
  /** Number of candidates accepted by the domain, including idempotent existing entries. */
  accepted: number;
  /** Number of candidates rejected before or by the domain boundary. */
  skipped: number;
}

/**
 * Registers the packaged daily-reward decorations without replacing user data.
 *
 * The domain command owns content validation, conflict handling and persistence:
 * an identical resource is a no-op, while a user resource that reuses a
 * packaged ID is never overwritten. The local size check keeps malformed or
 * accidentally oversized optional assets out of the command boundary too.
 */
export async function registerBuiltinDailyRewardBlueprints(
  service: Pick<ApplicationService, 'dispatch' | 'snapshot'>,
  blueprints: readonly BlueprintV1[],
): Promise<BuiltinDailyRewardRegistration> {
  let accepted = 0;
  let skipped = 0;
  const known = new Map(service.snapshot().decorationBlueprintResources.map((resource) => [resource.id, resource.blueprint]));
  for (const blueprint of blueprints) {
    if (!withinDecorationBudget(blueprint)) {
      skipped += 1;
      continue;
    }
    const imported = toImportedBlueprint(blueprint);
    if (JSON.stringify(known.get(imported.id)) === JSON.stringify(imported)) {
      // ApplicationService persists even successful no-op user commands. Do
      // this read-only check before dispatch so a normal restart does not
      // create a needless revision or IndexedDB write for either reward.
      accepted += 1;
      continue;
    }
    const result: ApplicationResult = await service.dispatch({
      type: 'ImportDecorationBlueprint',
      blueprint: imported,
    } as DecorationImportCommand);
    if (result.ok) {
      accepted += 1;
      known.set(imported.id, imported);
    } else skipped += 1;
  }
  return { examined: blueprints.length, accepted, skipped };
}

function withinDecorationBudget(blueprint: BlueprintV1): boolean {
  const width = blueprint.bounds.maxX - blueprint.bounds.minX + 1;
  const depth = blueprint.bounds.maxZ - blueprint.bounds.minZ + 1;
  const height = blueprint.bounds.maxY - blueprint.bounds.minY + 1;
  return width > 0 && width <= MAX_DECORATION_WIDTH
    && depth > 0 && depth <= MAX_DECORATION_DEPTH
    && height > 0 && height <= MAX_DECORATION_HEIGHT
    && blueprint.voxels.length > 0
    && blueprint.voxels.length <= MAX_DECORATION_VOXELS;
}
