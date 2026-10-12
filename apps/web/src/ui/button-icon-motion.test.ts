import { describe, expect, it } from 'vitest';
import { ICON_MOTION_MS, iconPartMotion } from './button-icon-motion';
describe('button glyph motion audit', () => {
  it('shares the timer duration and ends each staggered group at the same time', () => {
    for (let row = 0; row < 3; row++) for (const [name,part] of [['tasks',`task-line-${row}`],['chart',`bar-${row}`]])
      expect(iconPartMotion(name!,part!)!.duration + iconPartMotion(name!,part!)!.delay).toBe(ICON_MOTION_MS);
  });
  it('adds action-specific motion without treating refresh or delete as success', () => {
    for (const name of ['plus','edit','play','flag','map','chest','brand','close']) expect(iconPartMotion(name)).not.toBeNull();
    for (const name of ['reset','stop','check','portal']) expect(iconPartMotion(name)).toBeNull();
  });
  it('turns the top sheet over the binding and fades behind a stationary next page', () => {
    expect(iconPartMotion('calendar')).toBeNull();
    const page = iconPartMotion('calendar', 'turning-page')!;
    expect(page.duration).toBe(ICON_MOTION_MS);
    expect(page.keyframes.map(frame => frame.transform).join(' ')).toContain('rotateX(90deg)');
    expect(page.keyframes.at(-1)?.transform).toContain('rotateX(180deg)');
    expect(page.keyframes.at(-1)?.opacity).toBe(0);
  });
});
