import { describe, expect, it } from 'vitest';
import type { ImportedBlueprintV1 } from '@blockcolc/domain';
import { createBackupEnvelope, parseBackup, sha256, MAX_BACKUP_BYTES } from '../src/codec.js';
import { packBackupPayload, unpackBackupPayload } from '../src/compact-backup.js';
import { projectState } from './fixture.js';

function stateWithBlueprints(size: number, count: number) {
  const state = projectState(), base = state.projects[0]!, condition = state.projectConditions[0]!;
  const blueprint: ImportedBlueprintV1 = { schemaVersion: 1, id: 'backup-cube', title: 'Cube',
    bounds: { minX: 0, maxX: size - 1, minY: 0, maxY: size - 1, minZ: 0, maxZ: size - 1 }, voxels: [] };
  for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    blueprint.voxels.push({ x, y, z, materialId: 'wood', stage: 'foundation', buildOrder: 0, sourceBlockId: 'minecraft:oak_planks' });
  }
  state.projects = Array.from({ length: count }, (_, index) => ({ ...structuredClone(base), id: `project-${index}`, settlementIndex: index,
    status: index === count - 1 ? 'active' as const : 'paused' as const, blueprintId: blueprint.id, importedBlueprint: blueprint,
    subtasks: base.subtasks.map((item, i) => ({ ...item, id: `subtask-${index}-${i}` })) }));
  state.projectConditions = state.projects.map(project => ({ ...condition, projectId: project.id }));
  state.activeProjectId = state.projects.at(-1)!.id;
  return state;
}

describe('compact standalone backups', () => {
  it('round-trips five supported 60 cubed project snapshots beyond the old JSON cap', async () => {
    const state = stateWithBlueprints(60, 5);
    const backup = await createBackupEnvelope(state, new Date('2026-10-13T00:00:00.000Z'));
    expect(backup.schemaVersion).toBe(2);
    const json = JSON.stringify(backup);
    expect(new TextEncoder().encode(json).byteLength).toBeLessThan(MAX_BACKUP_BYTES);
    const imported = await parseBackup(json);
    expect(imported.payload.projects).toHaveLength(5);
    expect(imported.payload.projects[4]!.importedBlueprint).toEqual(state.projects[4]!.importedBlueprint);
    expect(imported.payload.projectConditions).toEqual(state.projectConditions);
    expect(imported.payload.activeProjectId).toBe(state.activeProjectId);
  }, 60_000);
  it('preserves distinct snapshots and voxel metadata without deduplicating by blueprint ID alone', () => {
    const state = stateWithBlueprints(2, 2);
    state.projects[1]!.importedBlueprint = structuredClone(state.projects[1]!.importedBlueprint);
    state.projects[1]!.importedBlueprint!.voxels[0]!.sourceBlockState = { axis: 'y' };
    const packed = packBackupPayload(state);
    expect(packed.blueprints).toHaveLength(2);
    expect(unpackBackupPayload(packed)).toEqual(state);
  });
  it('rejects tampering, missing references, invalid palettes and reference amplification', async () => {
    const payload = packBackupPayload(stateWithBlueprints(1, 2));
    const unsigned = { format: 'tomato-clock-backup', schemaVersion: 2, exportedAt: '2026-10-13T00:00:00.000Z', payload };
    const envelope = { ...unsigned, checksum: await sha256(unsigned) };
    envelope.payload.blueprints[0]!.title = 'tampered';
    await expect(parseBackup(JSON.stringify(envelope))).rejects.toThrow('checksum');
    const missing = structuredClone(payload); missing.blueprints = [];
    expect(() => unpackBackupPayload(missing)).toThrow('reference');
    const invalid = structuredClone(payload); invalid.blueprints[0]!.voxels[0]![3] = 999;
    expect(() => unpackBackupPayload(invalid)).toThrow('voxel');
    const amplified = structuredClone(payload);
    amplified.blueprints[0]!.palette[0]!.sourceBlockId = 'x'.repeat(2 * 1024 * 1024);
    amplified.blueprints[0]!.voxels = Array.from({ length: 300 }, (_, x) => [x, 0, 0, 0]);
    expect(() => unpackBackupPayload(amplified)).toThrow('expanded limit');
  });
});
