import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlannedFocusDaysSetting } from './PlannedFocusDaysSetting';
import { WorldDebugSettingsPanel } from './WorldDebugSettings';
import { NORMAL_WORLD_DEBUG } from './world-debug';

describe('compact calendar and world debug controls', () => {
  it('shows all seven days with the committed count and small pixel marks', () => {
    const html = renderToStaticMarkup(<PlannedFocusDaysSetting calendar={{ timeZone: 'Asia/Shanghai', restWeekdays: [0, 6] }} run={vi.fn()}/>);
    expect(html).toContain('每周 5 天');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(5);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html.match(/<i aria-hidden="true"/g)).toHaveLength(7);
  });
  it('cannot deselect the last planned focus day', () => {
    const html = renderToStaticMarkup(<PlannedFocusDaysSetting calendar={{ timeZone: 'Asia/Shanghai', restWeekdays: [0, 2, 3, 4, 5, 6] }} run={vi.fn()}/>);
    expect(html).toContain('每周 1 天');
    expect(html).toContain('aria-pressed="true" disabled=""');
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });
  it('uses an app-owned weather menu and keeps the debug off state collapsed', () => {
    const disabled = renderToStaticMarkup(<WorldDebugSettingsPanel value={NORMAL_WORLD_DEBUG} onChange={vi.fn()}/>);
    expect(disabled).not.toContain('id="world-debug-weather"');
    const enabled = renderToStaticMarkup(<WorldDebugSettingsPanel value={{ ...NORMAL_WORLD_DEBUG, enabled: true, weather: 'snow' }} onChange={vi.fn()}/>);
    expect(enabled).toContain('id="world-debug-weather"');
    expect(enabled).toContain('aria-haspopup="listbox"');
    expect(enabled).toContain('<strong>雪</strong>');
    expect(enabled).not.toContain('<select');
  });
});
