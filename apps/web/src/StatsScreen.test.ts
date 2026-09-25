import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { readAchievementReceipt, reconcileAchievementBatch, writeAchievementReceipt, MonumentStatistics, type AchievementReceiptStorage } from './StatsScreen';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AchievementEntry } from './ui/AchievementsPanel';
import type { MonumentFocusProjection, UnallocatedFocusProjection } from '@tomato-clock/application';

function storage(initial: string | null): AchievementReceiptStorage & { value: string | null; failWrites: boolean } {
  return {
    value: initial,
    failWrites: false,
    getItem() { return this.value; },
    setItem(_key, value) { if (this.failWrites) throw new Error('storage full'); this.value = value; },
  };
}

const unlocked = (id: string, isUnlocked = true): AchievementEntry => ({
  id, title: id, description: id, progress: isUnlocked ? 1 : 0, target: 1, unit: '轮', unlocked: isUnlocked, unlockedAt: null,
});

describe('achievement display receipts', () => {
  it('treats corrupt JSON as recoverable and starts a fresh receipt set', () => {
    const value = readAchievementReceipt(storage('{not-json'));
    expect(value.corrupt).toBe(true);
    expect([...value.seen]).toEqual([]);
  });

  it('writes a valid receipt when storage is healthy', () => {
    const target = storage(null);
    expect(writeAchievementReceipt(target, ['a', 'a', 'b'])).toBe(true);
    expect(target.value).toBe('["a","b"]');
  });

  it('reports a write failure without making the caller keep the dialog locked', () => {
    const target = storage(null);
    target.failWrites = true;
    expect(writeAchievementReceipt(target, ['a'])).toBe(false);
    expect(target.value).toBeNull();
  });

  it('reconciles pending history against the current projection after rollback/import', () => {
    const previous = [unlocked('removed'), unlocked('kept')];
    const current = [unlocked('removed', false), unlocked('kept'), unlocked('new')];
    expect(reconcileAchievementBatch(previous, current, new Set(['kept']), new Set())).toEqual([unlocked('kept'), unlocked('new')]);
    expect(reconcileAchievementBatch(previous, current, new Set(), new Set(['new']))).toEqual([unlocked('removed', false), unlocked('kept')].filter(entry => entry.unlocked));
  });
});

describe('monument statistics disclosure', () => {
  it('starts the section and every memorial card collapsed, then explains untraceable history inside', () => {
    const monument: MonumentFocusProjection = {
      id: 'monument-1', source: 'finite', projectId: 'project-1', title: '林间工坊', completedAt: null,
      expectedRounds: null, rounds: 1, interruptedRounds: 0, unknownRounds: 1, minutes: 25,
      interruptedMinutes: 0, unknownMinutes: 10,
      subtasks: [{ subtaskId: 'task-1', title: '提纲', rounds: 1, interruptedRounds: 0, minutes: 25, interruptedMinutes: 0, share: null }],
    };
    const unallocated: UnallocatedFocusProjection = { rounds: 3, completedRounds: 2, interruptedRounds: 1, minutes: 45 };
    const html = renderToStaticMarkup(createElement(MonumentStatistics, { monuments: [monument], unallocated }));
    expect(html).toContain('<details class="monument-statistics"><summary><span>纪念建筑</span><small>1 座已完成</small>');
    expect(html).toContain('展示可追溯投入；旧记录单列，不估算分配');
    expect(html).toContain('另有 2 个完成轮次、1 条中断记录未分配或无法追溯（共 45 分钟），未计入宿主任务或小任务占比。');
    expect(html).toContain('<details>');
    expect(html).not.toContain(' open=');
  });
});
