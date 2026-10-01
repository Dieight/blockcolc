import { describe, expect, it, vi } from 'vitest';
import { glassEdgeOffset, publishGlassWorldFrame, subscribeGlassWorldFrames } from './glass-refraction';

describe('glass edge background projection', () => {
  it('bends a narrow edge, returns to flat center and stays bounded', () => {
    expect(glassEdgeOffset(0, 24)).toBe(0);
    expect(glassEdgeOffset(24, 24)).toBe(0);
    expect(glassEdgeOffset(50, 24)).toBe(0);
    expect(glassEdgeOffset(6, 24)).toBeGreaterThan(4);
    for (let d = 0; d < 24; d++) expect(glassEdgeOffset(d, 24)).toBeLessThan(10);
    expect(glassEdgeOffset(1, 0)).toBe(0);
  });
  it('uses the supplied current canvas only, and releases the subscriber', () => {
    const source = {} as HTMLCanvasElement, listener = vi.fn();
    const unsubscribe = subscribeGlassWorldFrames(listener);
    publishGlassWorldFrame(source);
    expect(listener).toHaveBeenCalledWith(source, expect.any(Number));
    unsubscribe(); publishGlassWorldFrame(source);
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('isolates an unavailable presentation consumer from world frames and other consumers', () => {
    const source = {} as HTMLCanvasElement, broken = vi.fn(() => { throw new Error('unavailable glass surface'); });
    const working = vi.fn(), offBroken = subscribeGlassWorldFrames(broken), offWorking = subscribeGlassWorldFrames(working);
    expect(() => publishGlassWorldFrame(source)).not.toThrow();
    publishGlassWorldFrame(source);
    expect(broken).toHaveBeenCalledTimes(1); expect(working).toHaveBeenCalledTimes(2);
    offBroken(); offWorking();
  });
});
