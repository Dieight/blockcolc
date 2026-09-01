import { describe, expect, it } from 'vitest';
import type { DomainState } from '@tomato-clock/domain';
import type { ProjectWorldProjection } from '@tomato-clock/application';
import { createBuildingMemory } from './BuildingMemoryPanel';

function stateFixture(): DomainState {
  return {
    schemaVersion: 9,
    projects: [{
      id: 'project-a', title: '写作计划', kind: 'finite', settlementIndex: 0,
      blueprintId: 'builtin-small-workshop', importedBlueprint: null,
      createdAt: '2026-08-01T00:00:00.000Z', status: 'active', subtaskStructureLocked: true,
      subtasks: [
        { id: 'done', title: '提纲', order: 0, progressBasisPoints: 10_000 },
        { id: 'next', title: '完成第一章', order: 1, progressBasisPoints: 2_500 },
      ],
      habit: null,
    }],
    habitBuildings: [], activeProjectId: 'project-a', retiredSubtaskIds: [], activeFocusSession: null,
    focusHistory: [{
      id: 'focus-1', projectId: 'project-a', subtaskId: 'next', startedAt: '2026-08-30T01:00:00.000Z',
      endsAt: '2026-08-30T01:25:00.000Z', plannedDurationMs: 1_500_000, timeZoneAtStart: 'Asia/Shanghai',
      status: 'completed', completedAt: '2026-08-30T01:25:00.000Z', completedLocalDate: '2026-08-30', actualDurationMs: 1_500_000,
    }],
    progressReports: [], dailyGoals: [], projectConditions: [{ projectId: 'project-a', conditionBasisPoints: 9_000, inactivityAnchorAt: null, assessedMissedPlannedDays: 0 }],
    decayPolicy: { enabled: false, gracePlannedDays: 3, repairMultiplierBasisPoints: 20_000, damagePerMissedPlannedDayBasisPoints: null },
    calendar: { timeZone: 'Asia/Shanghai', restWeekdays: [] }, focusIntegrityPolicy: { enabled: false, maxEffectiveExcursions: 3 },
    buildingBlueprintResources: [], decorationBlueprintResources: [], decorationRewards: [], worldSettings: { environmentStyle: 'natural-valley', worldSeed: 'test', terrainGenerationVersion: 4 },
  };
}

function projection(): ProjectWorldProjection {
  return {
    project: { id: 'project-a', title: '写作计划', status: 'active', kind: 'finite', blueprintId: 'builtin-small-workshop' },
    isActive: true, settlementIndex: 0,
    building: { projectId: 'project-a', blueprintId: 'builtin-small-workshop', importedBlueprint: null, completionBasisPoints: 2_500, conditionBasisPoints: 9_000 },
    importedDecorations: [],
  };
}

describe('building memory', () => {
  it('derives focus history and the next unfinished subtask without stored duplicate state', () => {
    expect(createBuildingMemory(stateFixture(), projection(), '林间工坊')).toMatchObject({
      title: '写作计划', statusLabel: '正在建造', blueprintLabel: '林间工坊', completionPercent: 25,
      constructionStage: '框架与地板', conditionLabel: '保存完整', focusMinutes: 25,
      completedRounds: 1, lastFocusDate: '2026-08-30', nextStep: '完成第一章',
    });
  });
});
