import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DomainState } from '@tomato-clock/domain';
import type { ProjectWorldProjection } from '@tomato-clock/application';
import { BuildingMemoryPanel, createBuildingMemory } from './BuildingMemoryPanel';

function stateFixture(): DomainState {
  return {
    schemaVersion: 12,
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
    calendar: { timeZone: 'Asia/Shanghai', restWeekdays: [] }, focusIntegrityPolicy: { enabled: false, maxEffectiveExcursions: 3, excursionThresholdSeconds: 3 },
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

  it('does not show a marathon round under its host building after explicit cross-project attribution', () => {
    const state = stateFixture();
    state.projects.push({
      id: 'project-b', title: '另一座', kind: 'finite', settlementIndex: 1,
      blueprintId: 'builtin-small-workshop', importedBlueprint: null,
      createdAt: '2026-08-01T00:00:00.000Z', status: 'monument', subtaskStructureLocked: true,
      subtasks: [{ id: 'other-task', title: '另一项', order: 0, progressBasisPoints: 10_000 }], habit: null,
    });
    const focus = state.focusHistory[0]!;
    state.focusHistory[0] = { ...focus, marathon: true };
    state.progressReports = [{
      id: 'explicit-cross-project', projectId: 'project-b', subtaskId: 'other-task', focusSessionIds: [focus.id],
      progressBasisPoints: 10_000, reportedAt: '2026-08-30T02:00:00.000Z', allocation: 'explicit',
    }];
    expect(createBuildingMemory(state, projection(), '林间工坊')).toMatchObject({ focusMinutes: 0, completedRounds: 0, lastFocusDate: null });
  });

  it('keeps untraceable-time guidance short and points to the statistics detail', () => {
    const html = renderToStaticMarkup(createElement(BuildingMemoryPanel, {
      memory: {
        projectId: 'project-a', title: '建筑', statusLabel: '纪念建筑', isActive: false, isMonument: true,
        blueprintLabel: '蓝图', completionPercent: 100, constructionStage: '完成', conditionLabel: '保存完整',
        focusMinutes: 25, completedRounds: 1, interruptedRounds: 0, interruptedMinutes: 0,
        unknownRounds: 2, unknownMinutes: 50, lastFocusDate: null, nextStep: null,
      },
      onClose: () => undefined,
      onContinue: () => undefined,
    }));
    expect(html).toContain('另有 2 条记录无法追溯（50 分钟），未分摊。');
    expect(html).toContain('投入分布见统计页“纪念建筑”。');
    expect(html).not.toContain('详细的小任务投入分布');
  });
});
