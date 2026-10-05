import { describe, expect, it } from 'vitest';
import { choiceMenuPosition } from './choice-menu-position';

describe('bounded floating choice menu', () => {
  const viewport = { left: 8, right: 382, top: 8, bottom: 740 };
  it('opens below a high trigger without overlapping navigation', () => {
    expect(choiceMenuPosition({ left: 220, width: 154, top: 100, bottom: 144 }, viewport, 352))
      .toEqual({ left: 220, width: 154, top: 150, maxHeight: 320 });
  });
  it('flips upward near the bottom and keeps a long list scrollable', () => {
    expect(choiceMenuPosition({ left: 240, width: 180, top: 650, bottom: 694 }, viewport, 352))
      .toEqual({ left: 202, width: 180, top: 324, maxHeight: 320 });
  });
  it('respects keyboard-reduced visual viewport, long text and narrow screens', () => {
    const short = { left: 8, right: 312, top: 52, bottom: 284 };
    const menu = choiceMenuPosition({ left: 170, width: 360, top: 190, bottom: 234 }, short, 560);
    expect(menu).toEqual({ left: 8, width: 304, top: 52, maxHeight: 132 });
    expect(menu.top + menu.maxHeight).toBeLessThan(short.bottom);
  });
});
