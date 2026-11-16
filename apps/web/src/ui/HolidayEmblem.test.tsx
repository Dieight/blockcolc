import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { holidaysForYear } from '@blockcolc/domain';
import { HolidayPixelGlyph,HolidayEmblem } from './HolidayEmblem';

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

it('keeps the festival and birthday side by side without consuming other festival slots',()=>{
 const birthday={enabled:true,month:12,day:25};
 const first=renderToStaticMarkup(createElement(HolidayEmblem,{date:'2026-12-25',slot:0,birthday}));
 expect(first).toContain('holiday-emblem-group');expect(first).toContain('data-holiday="christmas"');expect(first).toContain('data-holiday="birthday"');
 expect((first.match(/holiday-emblem-button/g)??[])).toHaveLength(2);
 const second=renderToStaticMarkup(createElement(HolidayEmblem,{date:'2026-12-25',slot:1,birthday}));
 expect(second).toContain('data-holiday="christmas"');expect(second).not.toContain('data-holiday="birthday"');
 const only=renderToStaticMarkup(createElement(HolidayEmblem,{date:'2026-10-18',slot:0,birthday:{enabled:true,month:10,day:18}}));
 expect(only).toContain('data-holiday="birthday"');expect(only).not.toContain('holiday-emblem-group');
});
