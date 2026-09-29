import { describe, expect, it } from 'vitest';
import { decorationDatesByProject } from './world-projection';

describe('world projection performance diagnostic', () => {
  it('compares indexed projection with the former history scan on a fixed synthetic workload', () => {
    const sessionCount = 12_000;
    const goalCount = 365;
    const state = {
      focusHistory: Array.from({ length: sessionCount }, (_, index) => ({
        completedAt: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T${String(index).padStart(5, '0')}Z`,
        status: index % 4 === 0 ? 'interrupted' : 'completed',
        projectId: `project-${index % 24}`,
      })),
      dailyGoals: Array.from({ length: goalCount }, (_, index) => {
        const session = sessionCount - 1 - index * 20;
        return {
          date: `2025-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
          reachedAt: `2026-09-${String((session % 28) + 1).padStart(2, '0')}T${String(session).padStart(5, '0')}Z`,
        };
      }),
      decorationRewards: [],
    } as never;

    const reference = (): Map<string, string[]> => {
      const result = new Map<string, string[]>();
      for (const goal of (state as { dailyGoals: Array<{ date: string; reachedAt: string | null }> }).dailyGoals) {
        if (!goal.reachedAt) continue;
        const session = (state as { focusHistory: Array<{ completedAt: string; status: string; projectId: string }> }).focusHistory
          .find((candidate) => candidate.status !== 'interrupted' && candidate.completedAt === goal.reachedAt);
        if (!session) continue;
        const dates = result.get(session.projectId) ?? [];
        dates.push(goal.date);
        result.set(session.projectId, dates);
      }
      return result;
    };
    const medianMs = (run: () => unknown): number => {
      const values: number[] = [];
      for (let index = 0; index < 9; index += 1) {
        const started = performance.now();
        run();
        values.push(performance.now() - started);
      }
      values.sort((left, right) => left - right);
      return Number(values[4]!.toFixed(3));
    };

    expect(decorationDatesByProject(state)).toEqual(reference());
    const report = {
      workload: { focusHistory: sessionCount, dailyGoals: goalCount, importedRewardDates: 0 },
      medianMs: {
        repeatedHistoryScan: medianMs(reference),
        indexedProjection: medianMs(() => decorationDatesByProject(state)),
      },
      comparison: 'synthetic in-process projection only; excludes IndexedDB and renderer rebuild/frame cost',
    };
    console.log(`[world-projection-benchmark] ${JSON.stringify(report)}`);
  });
});
