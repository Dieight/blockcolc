import { describe, expect, it, vi } from 'vitest';
import { ApplicationPersistenceError, ApplicationService, type ApplicationCommand, type ApplicationResult, type NotificationPort, type StateRepository } from '@blockcolc/application';
import { parseDomainState, type DomainState, type ImportedBlueprintV1 } from '@blockcolc/domain';
import { BUILTIN_DAILY_REWARD_BLUEPRINTS, type BlueprintV1 } from '@blockcolc/voxel';
import { registerBuiltinDailyRewardBlueprints } from './builtin-daily-rewards';

type DecorationImportCommand = Extract<ApplicationCommand, { type: 'ImportDecorationBlueprint' }>;

function blueprint(id: string, overrides: Partial<BlueprintV1> = {}): BlueprintV1 {
  return {
    schemaVersion: 1,
    id,
    title: id,
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
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

class CanonicalCasRepository implements StateRepository {
  state: DomainState | null = null;
  revision = 0;
  saveCalls = 0;
  failNextSave = false;

  async load(): Promise<{ state: DomainState | null; revision: number }> {
    return { state: this.state === null ? null : structuredClone(this.state), revision: this.revision };
  }

  async save(state: DomainState, expectedRevision: number): Promise<number> {
    this.saveCalls += 1;
    if (expectedRevision !== this.revision) throw new Error('revision conflict');
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('fixture persistence failure');
    }
    this.state = parseDomainState(state);
    this.revision += 1;
    return this.revision;
  }
}

function applicationDependencies(repository: CanonicalCasRepository) {
  const notifications: NotificationPort = {
    requestPermission: async () => ({ permission: 'granted', precision: 'exact', canSchedule: true }),
    refreshCapability: async () => ({ permission: 'granted', precision: 'exact', canSchedule: true }),
    scheduleFocusCompletion: async () => {}, cancelFocusCompletion: async () => {},
    scheduleBreakCompletion: async () => {}, cancelBreakCompletion: async () => {},
  };
  let id = 0;
  return {
    repository,
    notifications,
    clock: { now: () => new Date('2026-09-22T04:00:00.000Z') },
    ids: { next: () => `fixture-${++id}` },
  };
}

function canonicalOrderCandidates(): BlueprintV1[] {
  return ['builtin-local-daily-duck', 'builtin-local-daily-tank', 'builtin-local-daily-lantern'].map((id) => blueprint(id, {
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
    voxels: [{
      x: 0, y: 0, z: 0, materialId: 'plank', buildOrder: 4_000,
      sourceBlockId: 'minecraft:oak_stairs',
      // Domain validation sorts these keys before the aggregate is saved.
      sourceBlockState: { waterlogged: 'false', half: 'bottom', facing: 'north' },
    }],
  }));
}

function contentOnlyHash(state: DomainState | null): string {
  const content = state?.decorationBlueprintResources.map(({ id, blueprint: saved }) => ({ id, blueprint: saved })) ?? [];
  return JSON.stringify(content);
}

describe('packaged daily reward blueprints', () => {
  it('maps newly packaged candidates to decoration import command shape', async () => {
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

  it('handles empty and incomplete optional bundles', async () => {
    const dispatch = vi.fn(async (_command: DecorationImportCommand): Promise<ApplicationResult> => accepted());
    await expect(registerBuiltinDailyRewardBlueprints({ dispatch, snapshot: emptySnapshot }, [])).resolves.toEqual({
      examined: 0,
      accepted: 0,
      skipped: 0,
    });
    await expect(registerBuiltinDailyRewardBlueprints({ dispatch, snapshot: emptySnapshot }, [blueprint('one-optional-reward')])).resolves.toEqual({
      examined: 1,
      accepted: 1,
      skipped: 0,
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
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

  it('is idempotent after real ApplicationService CAS save and restart when raw key order is normalized', async () => {
    const repository = new CanonicalCasRepository();
    const dependencies = applicationDependencies(repository);
    const candidates = canonicalOrderCandidates();
    let dispatchCalls = 0;
    let eventlessCalls = 0;
    const startService = async () => {
      const service = await ApplicationService.initialize(dependencies);
      await service.resume();
      const dispatch = service.dispatch.bind(service);
      service.dispatch = async (command) => {
        dispatchCalls += 1;
        const result = await dispatch(command);
        if (result.ok && result.events.length === 0) eventlessCalls += 1;
        return result;
      };
      return service;
    };

    const firstService = await startService();
    await expect(registerBuiltinDailyRewardBlueprints(firstService, candidates)).resolves.toEqual({ examined: 3, accepted: 3, skipped: 0 });
    const firstContent = contentOnlyHash(repository.state);
    expect(repository.revision).toBe(4);
    expect(repository.saveCalls).toBe(4);

    const restartedService = await startService();
    const beforeRestartRegistration = { revision: repository.revision, saveCalls: repository.saveCalls };
    await expect(registerBuiltinDailyRewardBlueprints(restartedService, candidates)).resolves.toEqual({ examined: 3, accepted: 3, skipped: 0 });
    expect(contentOnlyHash(repository.state)).toBe(firstContent);
    expect({ revision: repository.revision, saveCalls: repository.saveCalls }).toEqual(beforeRestartRegistration);
    expect(dispatchCalls).toBe(3);
    expect(eventlessCalls).toBe(0);
  });

  it('preserves a conflicting resource and allows valid optional-field enrichment through the domain', async () => {
    const conflictRepository = new CanonicalCasRepository();
    const conflictService = await ApplicationService.initialize(applicationDependencies(conflictRepository));
    const userOwned = { ...canonicalOrderCandidates()[0]!, title: 'User-owned reward' };
    await expect(registerBuiltinDailyRewardBlueprints(conflictService, [userOwned])).resolves.toMatchObject({ accepted: 1, skipped: 0 });
    const conflictContent = contentOnlyHash(conflictRepository.state);
    const conflictRevision = conflictRepository.revision;
    await expect(registerBuiltinDailyRewardBlueprints(
      conflictService,
      [{ ...userOwned, title: 'Packaged replacement' }],
    )).resolves.toMatchObject({ examined: 1, accepted: 0, skipped: 1 });
    expect(contentOnlyHash(conflictRepository.state)).toBe(conflictContent);
    expect(conflictRepository.revision).toBe(conflictRevision);

    const enrichmentRepository = new CanonicalCasRepository();
    const enrichmentService = await ApplicationService.initialize(applicationDependencies(enrichmentRepository));
    const complete = canonicalOrderCandidates()[1]!;
    const legacy = structuredClone(complete);
    delete legacy.voxels[0]!.sourceBlockState;
    await expect(registerBuiltinDailyRewardBlueprints(enrichmentService, [legacy])).resolves.toMatchObject({ accepted: 1 });
    const beforeEnrichmentRevision = enrichmentRepository.revision;
    await expect(registerBuiltinDailyRewardBlueprints(enrichmentService, [complete])).resolves.toMatchObject({ accepted: 1, skipped: 0 });
    expect(enrichmentRepository.revision).toBe(beforeEnrichmentRevision + 1);
    expect(enrichmentRepository.state?.decorationBlueprintResources.find((resource) => resource.id === complete.id)?.blueprint.voxels[0]?.sourceBlockState)
      .toEqual({ facing: 'north', half: 'bottom', waterlogged: 'false' });
  });

  it('rejects invalid candidates without blocking a later valid optional candidate', async () => {
    const repository = new CanonicalCasRepository();
    const service = await ApplicationService.initialize(applicationDependencies(repository));
    const valid = canonicalOrderCandidates()[0]!;
    const invalidSource = structuredClone(canonicalOrderCandidates()[1]!);
    invalidSource.voxels[0]!.sourceBlockId = '';
    const invalidState = structuredClone(canonicalOrderCandidates()[2]!);
    invalidState.voxels[0]!.sourceBlockState = { 'Bad Key': 'north' };
    const tooWide = blueprint('too-wide-local', {
      bounds: { minX: 0, maxX: 12, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      voxels: Array.from({ length: 13 }, (_, x) => ({ x, y: 0, z: 0, materialId: 'plank' as const, buildOrder: 4_000 })),
    });
    const result = await registerBuiltinDailyRewardBlueprints(service, [invalidSource, invalidState, tooWide, valid]);
    expect(result).toEqual({ examined: 4, accepted: 1, skipped: 3 });
    expect(repository.state?.decorationBlueprintResources.map((resource) => resource.id)).toEqual([valid.id]);
    expect(repository.revision).toBe(2);
  });

  it('propagates real application persistence failures instead of reporting acceptance', async () => {
    const repository = new CanonicalCasRepository();
    const service = await ApplicationService.initialize(applicationDependencies(repository));
    const revision = repository.revision;
    const content = contentOnlyHash(repository.state);
    repository.failNextSave = true;
    await expect(registerBuiltinDailyRewardBlueprints(service, [canonicalOrderCandidates()[0]!]))
      .rejects.toBeInstanceOf(ApplicationPersistenceError);
    expect(repository.revision).toBe(revision);
    expect(contentOnlyHash(repository.state)).toBe(content);
    expect(repository.saveCalls).toBe(2);
  });

  it.skipIf(BUILTIN_DAILY_REWARD_BLUEPRINTS.length === 0)('adds the three new packaged rewards without changing the original resources or repeating saves', async () => {
    const originalIds = new Set([
      'builtin-local-mysterious-enchanting-table', 'builtin-local-small-water-tank', 'builtin-local-wqh-yellow-duck',
    ]);
    const candidates = BUILTIN_DAILY_REWARD_BLUEPRINTS;
    const originalCandidates = candidates.filter(candidate => originalIds.has(candidate.id));
    expect(originalCandidates).toHaveLength(3);
    const repository = new CanonicalCasRepository();
    const dependencies = applicationDependencies(repository);
    const originalService = await ApplicationService.initialize(dependencies);
    await registerBuiltinDailyRewardBlueprints(originalService, originalCandidates);
    const originalResources = structuredClone(repository.state!.decorationBlueprintResources);
    const beforeUpgrade = { revision: repository.revision, saveCalls: repository.saveCalls };
    const upgraded = await ApplicationService.initialize(dependencies);
    await expect(registerBuiltinDailyRewardBlueprints(upgraded, candidates)).resolves.toEqual({ examined: 6, accepted: 6, skipped: 0 });
    expect(repository.state!.decorationBlueprintResources.filter(resource => originalIds.has(resource.id)))
      .toEqual(originalResources);
    expect(repository.state!.decorationBlueprintResources.filter(resource => !originalIds.has(resource.id)).map(resource => resource.id).sort())
      .toEqual(['builtin-local-dieight-afk-pool', 'builtin-local-gyp-afk-spot', 'builtin-local-zdrcgubjo4-iron-golem']);
    expect(repository.revision).toBe(beforeUpgrade.revision + 3);
    expect(repository.saveCalls).toBe(beforeUpgrade.saveCalls + 3);
    const afterUpgrade = { revision: repository.revision, saveCalls: repository.saveCalls };
    const restarted = await ApplicationService.initialize(dependencies);
    await registerBuiltinDailyRewardBlueprints(restarted, candidates);
    expect({ revision: repository.revision, saveCalls: repository.saveCalls }).toEqual(afterUpgrade);
  });

  it('is idempotent for whichever optional local reward bundle is present', async () => {
    const candidates = BUILTIN_DAILY_REWARD_BLUEPRINTS;
    expect(candidates.length === 0 || candidates.length === 6).toBe(true);
    const repository = new CanonicalCasRepository();
    const dependencies = applicationDependencies(repository);
    const first = await ApplicationService.initialize(dependencies);
    const firstResult = await registerBuiltinDailyRewardBlueprints(first, candidates);
    const savedIds = repository.state?.decorationBlueprintResources.map((resource) => resource.id) ?? [];
    const afterFirst = { revision: repository.revision, saveCalls: repository.saveCalls };
    const restarted = await ApplicationService.initialize(dependencies);
    await restarted.resume();
    const secondResult = await registerBuiltinDailyRewardBlueprints(restarted, candidates);
    expect(secondResult).toEqual(firstResult);
    expect(savedIds).toEqual(candidates.map((candidate) => candidate.id));
    expect({ revision: repository.revision, saveCalls: repository.saveCalls }).toEqual(afterFirst);
    console.info(JSON.stringify({ optionalLocalRewardCount: candidates.length, firstResult, secondResult, finalRevision: repository.revision, saveCalls: repository.saveCalls }));
  });
});
