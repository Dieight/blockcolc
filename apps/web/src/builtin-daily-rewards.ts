import type { ApplicationCommand, ApplicationResult, ApplicationService } from '@blockcolc/application';
import { parseDecorationBlueprint } from '@blockcolc/domain';
import type { BlueprintV1 } from '@blockcolc/voxel';
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
    let imported: ReturnType<typeof toImportedBlueprint>;
    try {
      imported = toImportedBlueprint(blueprint);
    } catch {
      skipped += 1;
      continue;
    }
    const existing = known.get(imported.id);
    if (existing !== undefined && sameCanonicalBlueprint(existing, imported)) {
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
      const persisted = result.state.decorationBlueprintResources?.find((resource) => resource.id === imported.id);
      known.set(imported.id, persisted?.blueprint ?? imported);
    } else skipped += 1;
  }
  return { examined: blueprints.length, accepted, skipped };
}

function withinDecorationBudget(blueprint: BlueprintV1): boolean {
  if (typeof blueprint !== 'object' || blueprint === null || typeof blueprint.bounds !== 'object' || blueprint.bounds === null
    || !Array.isArray(blueprint.voxels)) return false;
  const { minX, maxX, minY, maxY, minZ, maxZ } = blueprint.bounds;
  if (![minX, maxX, minY, maxY, minZ, maxZ].every(Number.isSafeInteger)) return false;
  const width = maxX - minX + 1;
  const depth = maxZ - minZ + 1;
  const height = maxY - minY + 1;
  return width > 0 && width <= MAX_DECORATION_WIDTH
    && depth > 0 && depth <= MAX_DECORATION_DEPTH
    && height > 0 && height <= MAX_DECORATION_HEIGHT
    && blueprint.voxels.length > 0
    && blueprint.voxels.length <= MAX_DECORATION_VOXELS;
}

function sameCanonicalBlueprint(existing: unknown, candidate: unknown): boolean {
  try {
    return JSON.stringify(parseDecorationBlueprint(existing)) === JSON.stringify(parseDecorationBlueprint(candidate));
  } catch {
    // Invalid data must still reach ApplicationService/domain validation rather
    // than being treated as an identical resource by this optional fast path.
    return false;
  }
}
