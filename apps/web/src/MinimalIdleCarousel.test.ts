import { describe, expect, it } from 'vitest';
import { pageAfterArrowKey, pageAfterHorizontalSwipe } from './MinimalIdleCarousel';

describe('minimal idle panel pages', () => {
  it('moves to the today panel only for an intentional right-to-left swipe', () => {
    expect(pageAfterHorizontalSwipe(0, -80, 8)).toBe(1);
    expect(pageAfterHorizontalSwipe(1, 80, -8)).toBe(0);
    expect(pageAfterHorizontalSwipe(0, 80, 0)).toBe(0);
    expect(pageAfterHorizontalSwipe(1, -80, 0)).toBe(1);
  });
  it('leaves vertical time selection and ordinary taps alone', () => {
    expect(pageAfterHorizontalSwipe(0, -45, 0)).toBe(0);
    expect(pageAfterHorizontalSwipe(0, -80, 100)).toBe(0);
    expect(pageAfterHorizontalSwipe(1, 10, 110)).toBe(1);
  });
  it('provides the same panel changes from left and right arrow keys', () => {
    expect(pageAfterArrowKey(0, 'ArrowRight')).toBe(1);
    expect(pageAfterArrowKey(1, 'ArrowLeft')).toBe(0);
    expect(pageAfterArrowKey(0, 'ArrowLeft')).toBe(0);
    expect(pageAfterArrowKey(1, 'ArrowRight')).toBe(1);
    expect(pageAfterArrowKey(0, 'ArrowUp')).toBe(0);
  });
});
