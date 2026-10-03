import type { CSSProperties } from 'react';

export interface PixelProgressProps {
  value: number;
  max?: number;
  label: string;
  /** Rounds have whole groups; continuous progress keeps fractional cells. */
  rounds?: boolean;
  className?: string;
  role?: 'progressbar' | 'meter';
}

export function pixelProgressCells(value: number, maximum: number, rounds = false) {
  const max = Number.isFinite(maximum) && maximum > 0 ? maximum : 1;
  const bounded = Number.isFinite(value) ? Math.max(0, Math.min(value, max)) : 0;
  const group = rounds ? Math.max(1, Math.ceil(max / 16)) : max / 16;
  const count = rounds ? Math.ceil(max / group) : 16;
  return { value: bounded, max, group, fills: Array.from({ length: count }, (_, index) => {
    const capacity = Math.min(group, max - index * group);
    return Math.max(0, Math.min(1, (bounded - index * group) / capacity));
  }) };
}

export function PixelProgress({ value, max = 100, label, rounds = false, className = '', role = 'progressbar' }: PixelProgressProps) {
  const cells = pixelProgressCells(value, max, rounds);
  return <div className={`pixel-progress-wrap ${className}`.trim()}>
    <div className={`pixel-progress${rounds ? ' pixel-progress-rounds' : ''}`} role={role}
      aria-label={label} aria-valuemin={0} aria-valuemax={cells.max} aria-valuenow={cells.value}
      style={{ '--pixel-cells': cells.fills.length } as CSSProperties}>
      {cells.fills.map((fill, index) => <i key={index} aria-hidden="true"><b style={{ width: `${fill * 100}%` }}/></i>)}
    </div>
    {rounds && cells.group > 1 && <small className="pixel-progress-scale">每格最多 {cells.group} 轮</small>}
  </div>;
}
