import { describe, expect, it } from 'vitest';
import { PORTAL_FRAME_MS, PORTAL_REVEAL_MS, portalFrameLayout, portalOpeningClip, portalBurnRevealFrames } from './mode-portal';

describe('portal cover geometry', () => {
  it('builds clockwise from the lower left using unique square stones', () => {
    const { size, stones } = portalFrameLayout(390, 844);
    expect(size).toBe(48.75);
    expect(stones[0]).toEqual({ x: 0, y: 844 - size, size, side: 'left' });
    expect(stones.map(stone => stone.side).filter((side, i, sides) => side !== sides[i - 1])).toEqual(['left', 'top', 'right', 'bottom']);
    expect(new Set(stones.map(s => `${s.x}:${s.y}`)).size).toBe(stones.length);
    expect(stones.every(s => s.size === size && s.x >= 0 && s.y >= 0 && s.x + size <= 390.001 && s.y + size <= 844.001)).toBe(true);
    const left = stones.filter(s => s.side === 'left');
    expect(left.slice(1).every((s, i) => s.y < left[i]!.y && left[i]!.y - s.y <= size)).toBe(true);
    expect(PORTAL_FRAME_MS).toBe(1000); expect(PORTAL_REVEAL_MS).toBe(500);
  });

  it.each([[320, 568], [736, 360], [1200, 800]])('keeps full edge coverage at %sx%s', (width, height) => {
    const { size, stones } = portalFrameLayout(width, height);
    expect(size).toBeGreaterThanOrEqual(40); expect(size).toBeLessThanOrEqual(80);
    for (const [x, y] of [[0, 0], [width - size, 0], [width - size, height - size], [0, height - size]])
      expect(stones.some(s => Math.abs(s.x - x!) < .001 && Math.abs(s.y - y!) < .001)).toBe(true);
  });

  it('opens a centered circle in pixels, not a stretched ellipse', () => {
    const closed = portalOpeningClip(390, 844, 0), half = portalOpeningClip(390, 844, 100);
    expect(closed).toContain('polygon(evenodd,');
    expect(closed).toContain('195.000px 422.000px');
    expect(half).toContain('295.000px 422.000px');
    expect(half).toContain('195.000px 522.000px');
    expect(closed.split(',')).toHaveLength(half.split(',').length);
    const radius = Math.hypot(390, 844) / 2 + 2;
    expect(radius).toBeGreaterThan(Math.hypot(195, 422));
  });

  it.each([[390,844],[844,390],[1200,800]])('burns an irregular pixel edge with a matched rim and complete final coverage at %sx%s',(width,height)=>{
    const frames=portalBurnRevealFrames(width,height);
    expect(frames[0]!.offset).toBe(0);expect(frames.at(-1)!.offset).toBe(1);
    expect(frames[0]!.rimOpacity).toBe(0);expect(frames.at(-1)!.rimOpacity).toBe(0);
    expect(new Set(frames.map(frame=>frame.clipPath.split(',').length)).size).toBe(1);
    expect(new Set(frames.map(frame=>frame.rimClipPath.split(',').length)).size).toBe(1);
    const edge=(clip:string)=>[...clip.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].slice(5,-1).map(match=>[Number(match[1]),Number(match[2])] as const);
    const burning=edge(frames[4]!.clipPath),reach=burning.map(([x,y])=>Math.hypot(x-width/2,y-height/2));
    expect(Math.max(...reach)-Math.min(...reach)).toBeGreaterThan(10);
    expect(burning.every(([x,y])=>Number.isInteger((x-width/2)/2)&&Number.isInteger((y-height/2)/2))).toBe(true);
    const finalReach=edge(frames.at(-1)!.clipPath).map(([x,y])=>Math.hypot(x-width/2,y-height/2));
    expect(Math.min(...finalReach)).toBeGreaterThan(Math.hypot(width,height)/2+8);
    expect(frames.every(frame=>frame.rimClipPath.startsWith('polygon(evenodd,'))).toBe(true);
  });
});
