import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { shiftClockSelection, minimalRoundDetentOffsetPx, MinimalClockGesture } from './MinimalClockGesture';
import { FocusFace } from './FocusFace';
import { FocusAllocationChart, FocusCalendarChart, MonumentFocusChart } from './FocusStatsCharts';
import { AchievementsSection } from './AchievementsPanel';

describe('shared focus face and clock gesture', () => {
  it('keeps empty context and control slots, without an extra minimal placeholder', () => {
    const html = renderToStaticMarkup(<FocusFace timer="12:00"/>);
    expect(html).toContain('focus-face-context');
    expect(html).toContain('focus-face-controls');
    expect(html).not.toContain('minimal-exit-placeholder');
  });
  it('renders only the current clock before selection and gives a keyboard instruction', () => {
    const html = renderToStaticMarkup(<MinimalClockGesture clockText="12:00" busy={false} onConfirm={() => {}}/>);
    expect(html).toContain('按方向键选择结束时间');
    expect(html).not.toContain('开始专注</button>');
    expect(html).not.toContain('minimal-clock-selection');
  });
  it('selects a minute-aligned end in five-minute increments and crosses midnight accurately', () => {
    const now = new Date(2026,8,9,23,58,30).getTime();
    expect(shiftClockSelection(null,1,now)).toBe(new Date(2026,8,10,0,3).getTime());
    expect(shiftClockSelection(shiftClockSelection(null,1,now),1,now)).toBe(new Date(2026,8,10,0,8).getTime());
  });
  it('bounds selection to a future minute and at most the next 24 hours', () => {
    const now = Date.parse('2026-09-09T08:00:30Z');
    expect(shiftClockSelection(null,-100,now)).toBeNull();
    expect(shiftClockSelection(shiftClockSelection(null,1,now),-1,now)).toBeNull();
    expect(shiftClockSelection(null,0,now)).toBeNull();
    expect(shiftClockSelection(null,10000,now)).toBe(Date.parse('2026-09-10T08:00:00Z'));
  });
  it('adds a short bounded drag resistance per crossed round and cannot accumulate into a lock', () => {
    expect(minimalRoundDetentOffsetPx(0)).toBe(0);
    expect(minimalRoundDetentOffsetPx(1)).toBe(10);
    expect(minimalRoundDetentOffsetPx(3)).toBe(30);
    expect(minimalRoundDetentOffsetPx(24)).toBe(120);
  });
});

describe('statistics template contracts', () => {
  it('uses fixed pixel bands, keeps zero days distinct, and disables future dates', () => {
    const days = [{date:'2026-09-07',minutes:25,sessions:1,future:false}, {date:'2026-09-08',minutes:100,sessions:2,future:false}, {date:'2026-09-09',minutes:0,sessions:0,future:false}, {date:'2026-09-10',minutes:500,sessions:4,future:true}];
    const html = renderToStaticMarkup(<FocusCalendarChart days={days} today="2026-09-09" selection={{start:'2026-09-07',end:'2026-09-09'}} onSelectionChange={() => {}}/>);
    expect(html).toContain('data-chart-template="F10"');
    expect([...html.matchAll(/class="calendar-pixel"/g)]).toHaveLength(4);
    expect(html).toContain('data-level="0"'); expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('data-minutes="500"');
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('calendar-selection');
    expect(html).not.toContain('is-selected');
    expect([...html.matchAll(/aria-selected="true"/g)]).toHaveLength(3);
    expect(html).toContain('calendar-day-hit');
    expect(html).toContain('tabindex="0"');
  });
  it('uses percentage clusters without bars or a clock ruler, preserving full task labels', () => {
    const html = renderToStaticMarkup(<FocusAllocationChart rows={[{projectId:'a',title:'完整长中文标题',minutes:100},{projectId:'b',title:'另一个任务',minutes:50}]} rangeLabel="近 30 天"/>);
    expect(html).toContain('data-chart-template="L14"');
    expect(html).toContain('data-percentage-units="67"'); expect(html).toContain('data-percentage-units="33"');
    expect(html).not.toContain('chart-tick');
    expect(html).toContain('完整长中文标题'); expect(html).toContain('50 分');
    expect(html).toContain('完整长中文标题 · 1 小时 40 分钟 · 66.7%');
    expect(html).toContain('aria-label="近 30 天专注时间占比。完整长中文标题 · 1 小时 40 分钟 · 66.7%；另一个任务 · 50 分钟 · 33.3%。');
    expect(html).toContain('allocation-cluster-name'); expect(html).toContain('allocation-cluster-time');
    expect([...html.matchAll(/data-allocation-unit="true"/g)]).toHaveLength(100);
  });
  it('keeps zero and extreme values honest without cross-chart definitions', () => {
    const html = renderToStaticMarkup(<>
      <FocusAllocationChart rows={[{projectId:'zero',title:'零投入',minutes:0},{projectId:'long',title:'一个很长的中文任务名称用于检查换行',minutes:120}]} rangeLabel="近 30 天"/>
      <FocusAllocationChart rows={[{projectId:'large',title:'极端长时长',minutes:7200}]} rangeLabel="近 90 天"/>
    </>);
    expect(html).not.toContain('clipPath');
    expect(html).toContain('data-minutes="0"');
    expect(html).toContain('data-percentage-units="0"');
    expect(html).toContain('data-percentage-units="100"');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
    expect(html).toContain('120 小时');
  });
  it('uses solid zero-origin monument bars without a ruler/tick footer', () => {
    const html = renderToStaticMarkup(<MonumentFocusChart rows={[{subtaskId:'a', title:'提纲', minutes:3, share:75}, {subtaskId:'b', title:'正文', minutes:1, share:25}]}/>);
    expect(html).toContain('data-chart-template="G3"');
    expect(html).toContain('monument-bar-fill');
    expect(html).toContain('data-extent="400"');
    expect(html).not.toContain('monument-tick');
    expect(html).not.toContain('chart-source');
  });
  it('starts achievements collapsed without changing the underlying unlocked projection', () => {
    const html = renderToStaticMarkup(<AchievementsSection entries={[]}/>);
    expect(html).toContain('<details class="achievements-disclosure">');
    expect(html).not.toContain(' open');
    expect(html).toContain('0 / 0 已解锁');
  });
});
