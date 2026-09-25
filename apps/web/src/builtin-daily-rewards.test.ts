import { describe, expect, it, vi } from 'vitest';
import type { ApplicationCommand, ApplicationResult } from '@tomato-clock/application';
import type { ImportedBlueprintV1 } from '@tomato-clock/domain';
import type { BlueprintV1 } from '@tomato-clock/voxel';
import { registerBuiltinDailyRewardBlueprints } from './builtin-daily-rewards';

type DecorationImportCommand = Extract<ApplicationCommand, { type: 'ImportDecorationBlueprint' }>;

function blueprint(id: string, overrides: Partial<BlueprintV1> = {}): BlueprintV1 {
  return {
    schemaVersion: 1,
    id,
    title: id,
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 },
    voxels: [{ x: 0, y: 0, z: 0, materialId: 'plank', buildOrder: 4_000 }],
    ...overrides,
  };
}

function accepted(): ApplicationResult {
  return { ok: true, state: {} as never, events: [], warnings: [] };
}

function emptySnapshot() {
  return { decorationBlueprintResources: [] } as never;
}

describe('packaged daily reward blueprints', () => {
  it('imports both candidates through the domain command and preserves idempotence at that boundary', async () => {
    const dispatch = vi.fn(async (_command: DecorationImportCommand): Promise<ApplicationResult> => accepted());
    const result = await registerBuiltinDailyRewardBlueprints(
      { dispatch, snapshot: emptySnapshot },
      [blueprint('builtin-local-daily-duck'), blueprint('builtin-local-daily-tank')],
    );

    expect(result).toEqual({ examined: 2, accepted: 2, skipped: 0 });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls.map(([command]) => command.type)).toEqual([
      'ImportDecorationBlueprint',
      'ImportDecorationBlueprint',
    ]);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: 'ImportDecorationBlueprint',
      blueprint: { id: 'builtin-local-daily-duck', voxels: [{ stage: 'walls' }] },
    });
  });

  it('does not weaken the 12 x 12 x 16 and 2,000 voxel decoration limits', async () => {
    const dispatch = vi.fn(async (_command: DecorationImportCommand): Promise<ApplicationResult> => accepted());
    const tooWide = blueprint('too-wide', { bounds: { minX: 0, maxX: 12, minY: 0, maxY: 0, minZ: 0, maxZ: 0 } });
    const tooTall = blueprint('too-tall', { bounds: { minX: 0, maxX: 0, minY: 0, maxY: 16, minZ: 0, maxZ: 0 } });
    const tooMany = blueprint('too-many', {
      voxels: Array.from({ length: 2_001 }, (_, index) => ({
        x: index,
        y: 0,
        z: 0,
        materialId: 'plank' as const,
        buildOrder: 4_000,
      })),
    });

    await expect(registerBuiltinDailyRewardBlueprints({ dispatch, snapshot: emptySnapshot }, [tooWide, tooTall, tooMany])).resolves.toEqual({
      examined: 3,
      accepted: 0,
      skipped: 3,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('handles an absent optional bundle as an empty candidate list', async () => {
    const dispatch = vi.fn(async (_command: DecorationImportCommand): Promise<ApplicationResult> => accepted());
    await expect(registerBuiltinDailyRewardBlueprints({ dispatch, snapshot: emptySnapshot }, [])).resolves.toEqual({
      examined: 0,
      accepted: 0,
      skipped: 0,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps a conflicting packaged ID under domain ownership instead of replacing it', async () => {
    const dispatch = vi.fn(async (): Promise<ApplicationResult> => ({
      ok: false,
      state: {} as never,
      code: 'INVALID_INPUT',
      message: 'Decoration blueprint ID conflicts with different content',
      warnings: [],
    }));
    await expect(registerBuiltinDailyRewardBlueprints(
      { dispatch, snapshot: emptySnapshot },
      [blueprint('user-owned-id')],
    )).resolves.toMatchObject({ examined: 1, accepted: 0, skipped: 1 });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('skips identical rewards on the second registration without dispatching or writing', async () => {
    let resources: Array<{ id: string; blueprint: ImportedBlueprintV1 }> = [];
    const dispatch = vi.fn(async (command: DecorationImportCommand): Promise<ApplicationResult> => {
      resources = [...resources, { id: command.blueprint.id, blueprint: command.blueprint }];
      return accepted();
    });
    const service = {
      dispatch,
      snapshot: () => ({ decorationBlueprintResources: resources }) as never,
    };
    const candidates = [blueprint('builtin-local-daily-duck'), blueprint('builtin-local-daily-tank')];

    await expect(registerBuiltinDailyRewardBlueprints(service, candidates)).resolves.toEqual({ examined: 2, accepted: 2, skipped: 0 });
    await expect(registerBuiltinDailyRewardBlueprints(service, candidates)).resolves.toEqual({ examined: 2, accepted: 2, skipped: 0 });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
