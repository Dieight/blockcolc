import { describe, expect, it } from 'vitest';
import { backLayerCount, handleBack, pushBackLayer } from './back-layer';

describe('back-layer routing', () => {
  it('delivers the gesture to the topmost layer first', () => {
    const consumed: string[] = [];
    const removeBottom = pushBackLayer(() => { consumed.push('bottom'); return true; });
    const removeTop = pushBackLayer(() => { consumed.push('top'); return true; });
    expect(handleBack()).toBe(true);
    expect(consumed).toEqual(['top']);
    removeTop();
    expect(handleBack()).toBe(true);
    expect(consumed).toEqual(['top', 'bottom']);
    removeBottom();
  });

  it('falls through a declining layer to the one below', () => {
    const removeBottom = pushBackLayer(() => true);
    const removeTop = pushBackLayer(() => false);
    expect(handleBack()).toBe(true);
    expect(backLayerCount()).toBe(2);
    removeTop();
    removeBottom();
  });

  it('reports the gesture unconsumed when no layer is open', () => {
    const remove = pushBackLayer(() => false);
    remove();
    expect(backLayerCount()).toBe(0);
    expect(handleBack()).toBe(false);
  });

  it('unregisters exactly once and tolerates repeated removal', () => {
    const remove = pushBackLayer(() => true);
    remove();
    remove();
    expect(backLayerCount()).toBe(0);
  });
});
