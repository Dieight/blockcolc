import { useMemo } from 'react';
import type { DomainState } from '@tomato-clock/domain';
import { projectTodayFocusTimeline, type TodayFocusSeries } from './today-focus-timeline';
import './styles/minimal-today.css';

function displaySeries(series: TodayFocusSeries[]): TodayFocusSeries[] {
  const known = series.filter(row => !row.unallocated).sort((a, b) => b.totalMs - a.totalMs || a.key.localeCompare(b.key));
  const unknown = series.filter(row => row.unallocated);
  return [...known, ...unknown];
}

function seriesColor(row: TodayFocusSeries, index: number): string {
  // Tasks stay distinguishable through a restrained four-step green-gray scale;
  // hue rotation would make the quiet panel read like a categorical dashboard.
  return row.unallocated ? 'var(--minimal-today-muted)' : `var(--minimal-today-task-${(index % 4) + 1})`;
}

function duration(ms: number): string {
  if (ms > 0 && ms < 60_000) return '不足 1 分钟';
  const minutes = Math.floor(ms / 60_000);
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

/** F3 Hairline Area, basics-gallery / "Concurrent users, filled with days".
 * The compact panel uses a pixelated stair-step translation: one square is
 * one occupied 15-minute interval, while the heading and legend retain the
 * exact millisecond totals from the shared timeline projection.
 */
export function MinimalTodayPanel({ state, date }: { state: DomainState; date: string }) {
  const data = useMemo(() => projectTodayFocusTimeline(state, date), [state, date]);
  const rows = useMemo(() => displaySeries(data.series), [data]);
  const pixels = Array.from({ length: 24 }, (_, hour) => Array.from({ length: 4 }, (_, quarter) => {
    const index = hour * 4 + quarter;
    let owner = -1;
    let milliseconds = 0;
    rows.forEach((row, rowIndex) => {
      const value = row.milliseconds[index]!;
      if (value > milliseconds) { milliseconds = value; owner = rowIndex; }
    });
    return { milliseconds, owner };
  }));
  const occupiedPerHour = pixels.map(hour => hour.filter(pixel => pixel.milliseconds > 0).length);
  const chartLeft = 12;
  const chartRight = 388;
  const chartBase = 94;
  const pixelWidth = (chartRight - chartLeft) / 24;
  const pixelHeight = 17;
  const x = (hour: number) => chartLeft + hour * pixelWidth;
  const outline = occupiedPerHour.map((count, hour) => `${hour === 0 ? 'M' : 'L'}${x(hour)},${chartBase - count * pixelHeight} L${x(hour + 1)},${chartBase - count * pixelHeight}`).join(' ');
  return <section className="minimal-today" aria-label="今日专注时间轴">
    <header className="minimal-today-heading">
      <div><span>今日专注</span><strong>{duration(data.totalMs)}</strong></div>
      <p><strong>{data.completedRounds}</strong><span>{data.targetRounds === null ? '轮' : ` / ${data.targetRounds} 轮`}</span></p>
    </header>
    <svg className="minimal-today-chart" viewBox="0 0 400 120" role="img"
      aria-label={`今日实际专注 ${duration(data.totalMs)}，横轴零点至二十四点，每小时最多堆叠四格，每格代表该小时内一段实际专注的十五分钟，颜色代表小任务或习惯。`}>
      {[6, 12, 18].map(hour => <line key={hour} x1={x(hour)} x2={x(hour)} y1="18" y2={chartBase} className="minimal-today-guide" />)}
      {pixels.map((hourPixels, hour) => <g key={hour} className="minimal-today-column" style={{ animationDelay: `${hour * 28}ms` }}>
        {hourPixels.filter(pixel => pixel.milliseconds > 0).map((pixel, level) => {
          const y = chartBase - (level + 1) * pixelHeight;
          const row = pixel.owner >= 0 ? rows[pixel.owner] : undefined;
          return <rect key={level} x={x(hour) + 0.5} y={y + 0.5} width={pixelWidth - 1} height={pixelHeight - 1}
            fill={row ? seriesColor(row, pixel.owner) : 'var(--muted)'} shapeRendering="crispEdges">
            <title>{row ? `${row.title} · ${duration(pixel.milliseconds)}` : `未分配 · ${duration(pixel.milliseconds)}`}</title>
          </rect>;
        })}
      </g>)}
      {occupiedPerHour.some(Boolean) && <path d={outline} fill="none" className="minimal-today-outline" />}
      {[0, 6, 12, 18, 24].map(hour => <text key={hour} x={x(hour)} y="115" textAnchor={hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'}>{String(hour).padStart(2, '0')}</text>)}
    </svg>
    {rows.length === 0 ? <p className="minimal-today-empty">今天的专注会留在这里</p> : <ul className="minimal-today-legend">
      {rows.map((row, index) => <li key={row.key} title={`${row.title} · ${duration(row.totalMs)}`}>
        <i aria-hidden="true" style={{ background: seriesColor(row, index) }} />
        <span>{row.title}</span><small>{duration(row.totalMs)}</small>
      </li>)}
    </ul>}
    <p className="minimal-today-note">时长按今日实际区间 · 轮次按完成日</p>
  </section>;
}
