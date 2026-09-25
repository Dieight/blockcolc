import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AchievementUnlockDialog, AchievementsPanel, type AchievementEntry } from './AchievementsPanel';

const entries: AchievementEntry[] = [
  { id: 'first-focus', title: '第一次专注', description: '完成第一个有效专注轮次', progress: 1, target: 1, unit: '轮', unlocked: true, unlockedAt: '2026-09-05T08:00:00Z' },
  { id: 'ten-rounds', title: '十轮基石', description: '累计完成 10 个有效专注轮次', progress: 4, target: 10, unit: '轮', unlocked: false, unlockedAt: null },
];

describe('AchievementsPanel（待接线展示组件）', () => {
  it('renders unlocked entries with their unlock date and locked entries with progress', () => {
    const html = renderToString(<AchievementsPanel entries={entries}/>);
    expect(html).toContain('成就');
    expect(html).toContain('第一次专注');
    expect(html).toContain('achievement unlocked');
    expect(html).toContain('2026/9/5');
    expect(html).toContain('十轮基石');
    expect(html).toContain('4 / 10 轮');
    // Exactly one unlocked badge (for the first entry only).
    expect((html.match(/achievement-unlocked/g) ?? []).length).toBe(1);
    expect(html).toContain('achievement-progress');
  });

  it('A2-01: unlocked=true with unknown date shows 已解锁 without inventing a date', () => {
    const html = renderToString(<AchievementsPanel entries={[{ ...entries[0]!, unlockedAt: null }]}/>);
    expect(html).toContain('已解锁');
    expect(html).not.toMatch(/已解锁.{0,80}\d{4}\/\d{1,2}\/\d{1,2}/u);
    expect(html).not.toContain(new Date().toLocaleDateString('zh-CN'));
  });

  it('renders the quiet empty state', () => {
    const html = renderToString(<AchievementsPanel entries={[]}/>);
    expect(html).toContain('还没有可展示的成就');
  });

  it('clamps overflowing progress meters', () => {
    const html = renderToString(<AchievementsPanel entries={[{ ...entries[1]!, progress: 99, target: 10 }]}/>);
    expect(html).toContain('width:100%');
  });

  it('renders historical unlocks in one batch and labels unknown dates without inventing one', () => {
    const html = renderToString(<AchievementUnlockDialog entries={[entries[0]!, { ...entries[1]!, unlocked: true, unlockedAt: null }]} onDismiss={() => undefined}/>);
    expect(html).toContain('新的成就');
    expect(html).toContain('data-entry-animation="unlock"');
    expect(html).toContain('第一次专注');
    expect(html).toContain('十轮基石');
    expect(html).toContain('获得时间未知（历史记录无法推导）');
    expect(html).toContain('全部关闭');
  });
});
