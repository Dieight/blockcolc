import { describe, expect, it } from 'vitest';
import { portalFlameFrame, PORTAL_FLAME_HEIGHT as height, PORTAL_FLAME_WIDTH as width } from './portal-flame';

const solid = (frame: Uint8ClampedArray, x: number, y: number) => frame[(y * width + x) * 4 + 3]! >= 100;
const rowShape = (frame: Uint8ClampedArray, y: number) => Array.from({ length: width }, (_, x) => solid(frame, x, y) ? '1' : '0').join('');

describe('continuous pixel fire column', () => {
  it('is deterministic, palette-based and leaves transparent canvas margins', () => {
    const first = portalFlameFrame(0);
    expect(first.length).toBe(width * height * 4);
    expect(portalFlameFrame(0)).toEqual(first);
    expect(portalFlameFrame(0).buffer).not.toBe(first.buffer);
    for (let x = 0; x < width; x++) {
      expect(first[x * 4 + 3]).toBe(0);
      expect(first[((height - 1) * width + x) * 4 + 3]).toBe(0);
    }
    for (let y = 0; y < height; y++) {
      expect(first[y * width * 4 + 3]).toBe(0);
      expect(first[(y * width + width - 1) * 4 + 3]).toBe(0);
    }
  });

  it('keeps all bright fire connected to its root throughout the cycle', () => {
    for (let time = 0; time < 8; time += .2) {
      const frame = portalFlameFrame(time), visited = new Set<number>(), queue: number[] = [];
      for (let x = 0; x < width; x++) if (solid(frame, x, 96)) { queue.push(96 * width + x); visited.add(96 * width + x); }
      for (let i = 0; i < queue.length; i++) {
        const at = queue[i]!, x = at % width;
        const adjacent = [at - width, at + width, ...(x > 0 ? [at - 1] : []), ...(x < width - 1 ? [at + 1] : [])];
        for (const next of adjacent) if (next >= 0 && next < width * height && !visited.has(next)
          && frame[next * 4 + 3]! >= 100) { visited.add(next); queue.push(next); }
      }
      let count = 0;
      for (let i = 0; i < width * height; i++) if (frame[i * 4 + 3]! >= 100) count++;
      expect(count).toBeGreaterThan(1500);
      expect(visited.size).toBe(count);
    }
  });

  it('has a broad continuous body and crown, not a permanent two-horn gap', () => {
    for (let time = 0; time < 8; time += .2) {
      const frame = portalFlameFrame(time);
      const lower = [55, 65, 75, 85].map(y => [...rowShape(frame, y)].filter(v => v === '1').length);
      expect(Math.min(...lower)).toBeGreaterThan(27);
      expect(solid(frame, 30, 32)).toBe(true);
      expect([...rowShape(frame, 32)].filter(v => v === '1').length).toBeGreaterThan(20);
    }
  });

  it('changes the crown and the entire lower body without an attached static skirt', () => {
    const frames = [0, .3, .8, 1.7, 2.6].map(portalFlameFrame);
    for (const y of [20, 32, 55, 75, 93]) expect(new Set(frames.map(frame => rowShape(frame, y))).size).toBeGreaterThan(1);
    for (const y of [40, 65, 90]) {
      const rows = frames.map(frame => frame.slice(y * width * 4, (y + 1) * width * 4).join(':'));
      expect(new Set(rows).size).toBe(frames.length);
    }
  });

  it('has bright, moving inner filaments and several pixel color layers', () => {
    const first = portalFlameFrame(0), next = portalFlameFrame(.4), colors = new Set<string>();
    let hot = 0, changed = 0;
    for (let y = 30; y < 96; y++) for (let x = 8; x < 52; x++) {
      const at = (y * width + x) * 4;
      if (!solid(first, x, y)) continue;
      colors.add(first.slice(at, at + 4).join(':'));
      if (first[at]! >= 246) hot++;
      if (first[at] !== next[at]) changed++;
    }
    expect(colors.size).toBeGreaterThanOrEqual(8);
    expect(hot).toBeGreaterThan(100);
    expect(changed).toBeGreaterThan(600);
  });

  it('moves gradually at the display cadence instead of replacing the whole silhouette', () => {
    for (let time = 0; time < 3; time += .1) {
      const before = portalFlameFrame(time), after = portalFlameFrame(time + 1 / 30);
      let occupied = 0, toggled = 0;
      for (let i = 3; i < before.length; i += 4) {
        if (before[i]! >= 100 || after[i]! >= 100) occupied++;
        if ((before[i]! >= 100) !== (after[i]! >= 100)) toggled++;
      }
      expect(toggled / occupied).toBeLessThan(.12);
    }
  });
});
