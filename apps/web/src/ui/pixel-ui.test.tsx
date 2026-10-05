import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PixelIcon } from './PixelIcon';
import { PixelProgress, pixelProgressCells } from './PixelProgress';

describe('pixel UI primitives', () => {
  it('renders decorative glyphs as a single crisp SVG path', () => {
    const html = renderToStaticMarkup(<PixelIcon name="tasks"/>);
    expect(html).toContain('viewBox="0 0 11 11"');
    expect(html).toContain('shape-rendering="crispEdges"');
    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/<path/g)).toHaveLength(1);
    expect(html).not.toContain('canvas');
  });

  it('retains continuous values rather than rounding to complete cells', () => {
    const result = pixelProgressCells(38, 100);
    expect(result.fills).toHaveLength(16);
    expect(result.fills.reduce((sum, fill) => sum + fill, 0) / 16 * 100).toBeCloseTo(38);
    const html = renderToStaticMarkup(<PixelProgress value={38} label="施工进度 38%"/>);
    expect(html).toContain('aria-valuenow="38"');
  });

  it('lights one cell per round for small goals and bounds larger goals without losing the remainder', () => {
    expect(pixelProgressCells(3, 8, true).fills).toEqual([1, 1, 1, 0, 0, 0, 0, 0]);
    const large = pixelProgressCells(17, 56, true);
    expect(large.fills).toHaveLength(14);
    expect(large.group).toBe(4);
    expect(large.fills[4]).toBe(.25);
    expect(pixelProgressCells(55, 55, true).fills.every(fill => fill === 1)).toBe(true);
    expect(pixelProgressCells(17, 999_999, true).fills.length).toBeLessThanOrEqual(16);
  });

  it('bounds invalid values, over-completion and zero targets', () => {
    expect(pixelProgressCells(-5, 8, true).value).toBe(0);
    expect(pixelProgressCells(10, 8, true).fills.every(fill => fill === 1)).toBe(true);
    expect(pixelProgressCells(NaN, 0).fills.every(fill => fill === 0)).toBe(true);
  });
});
