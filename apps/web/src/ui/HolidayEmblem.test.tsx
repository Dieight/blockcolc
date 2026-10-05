import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { holidaysForYear } from '@blockcolc/domain';
import { HolidayPixelGlyph } from './HolidayEmblem';

it('draws every approved holiday emblem as its own bounded pixel sprite', () => {
  const symbols=new Set(holidaysForYear(2026).flatMap(h=>h.emblems));
  expect(symbols.size).toBeGreaterThanOrEqual(39);
  const glyphs=new Set<string>();
  for(const emblem of symbols){
    const markup=renderToStaticMarkup(createElement(HolidayPixelGlyph,{emblem}));
    expect(markup).toContain('shape-rendering="crispEdges"');
    expect(markup).toContain('<rect');
    expect(markup).not.toContain('undefined');
    for(const [,coordinate] of markup.matchAll(/ [xy]="([\d.]+)"/g)){
      expect(Number(coordinate)).toBeGreaterThanOrEqual(0);
      expect(Number(coordinate)).toBeLessThanOrEqual(11);
    }
    glyphs.add(markup);
  }
  expect(glyphs.size).toBe(symbols.size);
});
