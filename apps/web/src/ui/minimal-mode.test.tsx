import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AchievementsPanel, AchievementsSection, type AchievementEntry } from './AchievementsPanel';
import { MinimalIdlePanel } from './MinimalIdlePanel';
import { MinimalEndTimeSheet } from './MinimalEndTimeSheet';
import { MinimalModeSettingRow } from './MinimalModeSettingRow';

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

  it('A4-05: the meter carries its own accessible name', () => {
    const html = renderToString(<AchievementsPanel entries={[{ ...entries[1]! }]}/>);
    expect(html).toMatch(/role="meter"[^>]*aria-label="进度 4 \/ 10 轮"/);
  });
});

describe('UI-SMALL-01 AchievementsSection（统计页收口）', () => {
  it('renders nothing when entries are not provided', () => {
    expect(renderToString(<AchievementsSection/>)).toBe('');
  });

  it('renders the empty hint for an empty array', () => {
    const html = renderToString(<AchievementsSection entries={[]}/>);
    expect(html).toContain('还没有可展示的成就');
  });

  it('renders provided entries read-only', () => {
    const html = renderToString(<AchievementsSection entries={entries}/>);
    expect(html).toContain('第一次专注');
  });
});

describe('MINI-27-01 极简模式展示组件（待接线）', () => {
  const sheetProps = { hourDraft: '18', minuteDraft: '30', invalidReason: null, busy: false, onHourChange: () => {}, onMinuteChange: () => {}, onClose: () => {}, onSubmit: () => {} };

  it('idle panel shows the start action and a full-mode exit (clock is host-rendered, DF-A1-04)', () => {
    const html = renderToString(<MinimalIdlePanel onStartFocus={() => {}} onExitMinimal={() => {}}/>);
    expect(html).toContain('开始专注');
    expect(html).toContain('返回完整模式');
    expect(html).not.toContain('is-veiled');
  });

  it('DF-UI-05: exitVisible=false veils the exit but keeps it in the DOM', () => {
    const html = renderToString(<MinimalIdlePanel exitVisible={false} onStartFocus={() => {}} onExitMinimal={() => {}}/>);
    expect(html).toContain('minimal-exit is-veiled');
    expect(html).toContain('返回完整模式');
  });

  it('A4-03: busy disables the exit together with the start action', () => {
    const html = renderToString(<MinimalIdlePanel busy onStartFocus={() => {}} onExitMinimal={() => {}}/>);
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
  });

  it('用户回滚指示: end sheet renders the shared stepper and shows the time in the main button', () => {
    const html = renderToString(<MinimalEndTimeSheet {...sheetProps}/>);
    expect(html).toContain('开始 · 至 18:30');
    expect(html).toContain('aria-label="减少结束小时"');
    expect(html).toContain('aria-label="增加结束分钟"');
    expect(html).toContain('结束小时">18</strong>');
    expect(html).not.toContain('input');
  });

  it('用户回滚指示: stepper clamps internally so drafts always stay submittable', () => {
    const html = renderToString(<MinimalEndTimeSheet {...sheetProps} hourDraft="0" minuteDraft="00"/>);
    expect(html).toContain('开始 · 至 00:00');
    expect(html).not.toContain('输入结束时间');
  });

  it('A3-05/A4 视觉附项: the unified-settlement note and the invalid variant', () => {
    expect(renderToString(<MinimalEndTimeSheet {...sheetProps}/>)).toContain('全部轮次结束后，统一提交进度。');
    const html = renderToString(<MinimalEndTimeSheet {...sheetProps} invalidReason="结束时间过近"/>);
    expect(html).toContain('plan-sheet-note is-invalid');
    expect(html).toContain('结束时间过近');
  });
});

describe('UI-SMALL-02 MinimalModeSettingRow（极简偏好行）', () => {
  it('keeps checked and aria-checked consistent with the enabled prop', () => {
    const on = renderToString(<MinimalModeSettingRow enabled onChange={() => {}}/>);
    expect(on).toContain('极简模式');
    expect(on).toContain('启动直接进入沉浸计时');
    expect(on).toContain('checked=""');
    expect(on).toContain('aria-checked="true"');
    const off = renderToString(<MinimalModeSettingRow enabled={false} onChange={() => {}}/>);
    expect(off).toContain('aria-checked="false"');
  });

  it('marks the row disabled; interactive flip assertions live in tools/minimal-sheet-contracts.mjs (no DOM test lib installed)', () => {
    const html = renderToString(<MinimalModeSettingRow enabled disabled onChange={() => {}}/>);
    expect(html).toContain('disabled=""');
  });
});
