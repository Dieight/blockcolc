import { describe, expect, it } from 'vitest';
import { ICON_MOTION_MS, iconPartMotion } from './button-icon-motion';
describe('button glyph motion audit', () => {
  it('shares the timer duration and ends each staggered group at the same time', () => {
    for (let row = 0; row < 3; row++) for (const [name,part] of [['tasks',`task-line-${row}`],['chart',`bar-${row}`]])
      expect(iconPartMotion(name!,part!)!.duration + iconPartMotion(name!,part!)!.delay).toBe(ICON_MOTION_MS);
  });
  it('adds action-specific motion without treating refresh, close or delete as success', () => {
    for (const name of ['plus','edit','play','flag','calendar','map','chest','brand']) expect(iconPartMotion(name)).not.toBeNull();
    for (const name of ['reset','stop','close','check','portal']) expect(iconPartMotion(name)).toBeNull();
  });
});
