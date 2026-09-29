import { describe, expect, it } from 'vitest';
import type { WorldSnapshot } from '@blockcolc/voxel';
import { qualityLifecycleWorldIdentity } from '../../../packages/voxel/src/quality-lifecycle-world-identity';

const world: WorldSnapshot = {
  projectId: 'project-test',
  blueprintId: 'builtin-small-workshop',
  buildingCompletionBasisPoints: 0,
  buildingConditionBasisPoints: 10_000,
  isMonument: false,
  isActive: true,
  settlementIndex: 0,
  decorationDates: [],
  importedDecorations: [],
};

describe('quality lifecycle world identity fingerprint', () => {
  it('is stable for the same projection and changes with project/world geometry inputs', () => {
    const fingerprint = qualityLifecycleWorldIdentity([world], 'world-seed', 'natural-valley', 4);
    expect(qualityLifecycleWorldIdentity([{ ...world }], 'world-seed', 'natural-valley', 4)).toBe(fingerprint);
    expect(qualityLifecycleWorldIdentity([{ ...world, projectId: 'another-project' }], 'world-seed', 'natural-valley', 4)).not.toBe(fingerprint);
    expect(qualityLifecycleWorldIdentity([{ ...world, buildingCompletionBasisPoints: 2500 }], 'world-seed', 'natural-valley', 4)).not.toBe(fingerprint);
    expect(qualityLifecycleWorldIdentity([world], 'another-seed', 'natural-valley', 4)).not.toBe(fingerprint);
    expect(qualityLifecycleWorldIdentity([world], 'world-seed', 'classic-island', 4)).not.toBe(fingerprint);
    expect(qualityLifecycleWorldIdentity([world], 'world-seed', 'natural-valley', 3)).not.toBe(fingerprint);
  });
});
