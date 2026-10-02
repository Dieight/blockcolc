import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { addLocalDays } from '@blockcolc/domain';
import { allocationPercentageUnits, allocationWeight } from '../focus-allocation-field';

export interface CalendarDay { date:string; minutes:number; sessions:number; future:boolean }
export interface AllocationRow { projectId:string; title:string; minutes:number; durationMs?:number; unallocated?:boolean }
export interface MonumentTaskRow { subtaskId:string; title:string; minutes:number; share:number|null }

const ALLOCATION_BAR_WIDTH = 400;
const ALLOCATION_BAR_HEIGHT = 16;

function allocationBarPath(width:number):string {
  const boundedWidth = Math.min(ALLOCATION_BAR_WIDTH, Math.max(0, width));
  const radius = Math.min(ALLOCATION_BAR_HEIGHT / 2, boundedWidth / 2);
  return 'M0 0H' + (boundedWidth - radius) + 'Q' + boundedWidth + ' 0 ' + boundedWidth + ' ' + radius
    + 'V' + (ALLOCATION_BAR_HEIGHT - radius) + 'Q' + boundedWidth + ' ' + ALLOCATION_BAR_HEIGHT + ' ' + (boundedWidth - radius)
    + ' ' + ALLOCATION_BAR_HEIGHT + 'H0Z';
}

const delay = (seconds:number): CSSProperties => ({ animationDelay:`${seconds}s` });

/** React version of MONO.obsReveal: once on entry, explicit replay, cleanup on unmount. */
function useChartReveal() {
  const ref = useRef<HTMLElement>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') { setRevision(1); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setRevision(1); observer.disconnect(); }
    }, {threshold:0.3});
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return {ref, revision, replay:() => setRevision(value => value + 1)};
}

/** F10 Dot Heat / basics-gallery.html / “When support gets loud”. */
export function FocusCalendarChart({ days, today }: { days:CalendarDay[]; today:string }) {
  const reveal = useChartReveal();
  const [date, setDate] = useState<string | null>(null);
  const first = days[0]?.date ?? today;
  const chosen = days.find(day => day.date === date);
  const maximum = Math.max(0, ...days.filter(day => !day.future).map(day => day.minutes));
  const peak = maximum > 0 ? days.find(day => !day.future && day.minutes === maximum) : undefined;
  const months = days.flatMap((day,index) => day.date.endsWith('-01') || index === 0 ? [{column:Math.floor(index / 7), label:`${Number(day.date.slice(5,7))}月`}] : [])
    .filter((month,index,list) => (list[index + 1]?.column ?? 26) - month.column >= 3);
  const x = (index:number) => 34 + Math.floor(index / 7) * 12;
  const y = (index:number) => 30 + index % 7 * 15;
  const stepDate = (step:number) => setDate(value => {
    const next = addLocalDays(value ?? today, step); return next < first ? first : next > today ? today : next;
  });
  const dateLabel = (value:string) => `${Number(value.slice(0,4))}年${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日`;
  return <section className="focus-chart focus-heatmap-card" ref={reveal.ref} data-chart-template="F10" aria-labelledby="focus-heatmap-title">
    <div className="stats-section-heading"><div><h2 id="focus-heatmap-title">过去 26 周的投入</h2><p>固定日历 · 点击日期查看专注</p></div></div>
    <svg key={reveal.revision} className={`focus-calendar-chart${reveal.revision ? ' is-revealed' : ''}`} viewBox="0 0 350 145" role="img"
      tabIndex={0} aria-label={`${peak ? `过去 26 周有效专注，最多为 ${peak.date} 的 ${peak.minutes} 分钟` : '过去 26 周暂无有效专注'}。点击日期查看；方向键切换日期，Escape 关闭详情。`}
      onKeyDown={event => {
        const offset = {ArrowLeft:-7,ArrowRight:7,ArrowUp:-1,ArrowDown:1}[event.key];
        if (offset !== undefined) { event.preventDefault(); stepDate(offset); }
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDate(value => value ?? today); }
        else if (event.key === 'Escape') { event.preventDefault(); setDate(null); }
        else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setDate(event.key === 'Home' ? first : today); }
      }}>
      {months.map(month => <text key={month.column} x={34 + month.column * 12} y={12} className="chart-axis chart-month">{month.label}</text>)}
      {['一','二','三','四','五','六','日'].map((day,index) => <text key={day} x={18} y={33 + index * 15} textAnchor="end" className="chart-axis">{day}</text>)}
      {days.map((day,index) => {
        if (day.future) return <g key={day.date} data-date={day.date} data-future="true"/>;
        // The reference uses sqrt; omit its additive radius so area stays exactly proportional.
        const radius = day.minutes > 0 ? Math.sqrt(day.minutes / Math.max(1,maximum)) * 4.6 : 1.2;
        return <g key={day.date} data-date={day.date} data-minutes={day.minutes} className={`calendar-day${date === day.date ? ' is-selected' : ''}`}
          onClick={() => setDate(value => value === day.date ? null : day.date)}>
          <title>{`${dateLabel(day.date)} · ${formatFocusMinutes(day.minutes)} · ${day.sessions} 次`}</title>
          <rect className="calendar-day-hit" x={x(index)-6} y={y(index)-7.5} width={12} height={15} fill="transparent"/>
          <circle className={`chart-mark chart-dot ${day.minutes === 0 ? 'is-empty' : day.minutes > maximum * .66 ? 'is-strong' : day.minutes > maximum * .33 ? 'is-medium' : 'is-soft'}`}
            cx={x(index)} cy={y(index)} r={radius} style={delay(index % 7 * .05 + Math.floor(index / 7) * .015)}/>
          {day === peak && <circle className="chart-peak chart-mark" cx={x(index)} cy={y(index)} r={radius + 2.4} style={delay(1)}/>}
          {date === day.date && <rect className="calendar-selection" x={x(index)-5.5} y={y(index)-6.5} width={11} height={13} rx={2}/>}
        </g>;
      })}
    </svg>
    {chosen && <div className="calendar-day-detail" role="status">
      <button type="button" aria-label="查看前一天专注" onClick={() => stepDate(-1)} disabled={chosen.date <= first}>‹</button>
      <div><strong>{dateLabel(chosen.date)}</strong><span>{chosen.minutes > 0 ? `${formatFocusMinutes(chosen.minutes)} · ${chosen.sessions} 次专注` : '这一天还没有有效专注记录'}</span></div>
      <button type="button" aria-label="查看后一天专注" onClick={() => stepDate(1)} disabled={chosen.date >= today}>›</button>
      <button type="button" aria-label="关闭日期详情" onClick={() => setDate(null)}>×</button>
    </div>}
  </section>;
}

/** L14 Hundred Field / lupi-gallery.html / “A hundred of us, four minds”.
 * Actual duration owns the shares; dots are approximate percentage units.
 * Retain the template's golden-angle clusters, every-fifth spoke and core
 * connections. Exact task labels/time remain outside the plotting geometry.
 */
export function FocusAllocationChart({ rows, rangeLabel }: { rows:AllocationRow[]; rangeLabel:string }) {
  const reveal = useChartReveal();
  const units = allocationPercentageUnits(rows);
  const total = rows.reduce((sum,row) => sum + allocationWeight(row),0);
  const centers = rows.length === 1 ? [[200,88]] : rows.length === 2 ? [[122,96],[286,96]]
    : rows.length === 3 ? [[110,88],[290,88],[200,225]] : rows.length === 4 ? [[132,140],[276,116],[186,252],[322,238]]
    : rows.map((_,index) => [index % 2 ? 290 : 110, 95 + Math.floor(index / 2) * 130]);
  const height = rows.length === 1 ? 185 : rows.length === 2 ? 200 : rows.length === 3 ? 310 : rows.length === 4 ? 320 : 440;
  const rnd = (i:number,k:number) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;
  const shade = (index:number,row:AllocationRow):CSSProperties => ({ '--allocation-ink':row.unallocated ? 'var(--chart-faint)' : ['var(--chart-data)','var(--chart-data-mid)','var(--chart-data-soft)','var(--chart-muted)','color-mix(in srgb,var(--chart-data) 50%,var(--chart-paper))','var(--chart-ink)'][index % 6] } as CSSProperties);
  const share = (row:AllocationRow) => {
    const value = total > 0 ? allocationWeight(row) / total * 100 : 0;
    return value > 0 && value < 1 ? '<1%' : `${Number(value.toFixed(1))}%`;
  };
  const time = (row:AllocationRow) => allocationWeight(row) > 0 && row.minutes === 0 ? '不足 1 分钟' : formatFocusMinutes(row.minutes);
  return <section className="focus-chart project-allocation" ref={reveal.ref} data-chart-template="L14" aria-labelledby="project-allocation-title">
    <div className="stats-section-heading"><div><h2 id="project-allocation-title">时间花在了哪里</h2><p>{rangeLabel} · 一簇投入，一项任务</p></div></div>
    {total === 0 ? <p className="chart-empty">开始一次专注，投入会在这里留下记录。</p> : <div key={`${rangeLabel}-${reveal.revision}`} className={`allocation-field${reveal.revision ? ' is-revealed' : ''}`}>
      <svg className="allocation-constellation" viewBox={`0 0 400 ${height}`} role="img" aria-label={`专注时间占比。${rows.map(row => `${row.title} · ${time(row)} · ${share(row)}`).join('；')}。每个散点约为总投入的 1%，精确时长和占比见下方任务列表。`}>
        {centers.slice(0,rows.length).slice(1).map(([x,y],index) => <line key={index} x1={centers[index]![0]} y1={centers[index]![1]} x2={x} y2={y} className="allocation-link chart-mark" style={delay(.9 + index * .1)}/>)}
        {rows.map((row,index) => {
          const [cx,cy] = centers[index]!;
          let edge = 0;
          const points = Array.from({length:units[index]!},(_,k) => {
            const angle = (k * 137.508 + index * 55) * Math.PI / 180;
            const radius = 4 + Math.sqrt(k) * 5.9 + rnd(k+1,index+2) * 3;
            edge = Math.max(edge,radius);
            return {x:cx! + radius * Math.cos(angle), y:cy! + radius * Math.sin(angle), radius:1.5 + rnd(k+2,index+3) * 1.7};
          });
          return <g key={row.projectId} style={shade(index,row)} data-project-id={row.projectId} data-percentage-units={units[index]}>
            <title>{`${row.title} · ${time(row)} · ${share(row)}`}</title>
            {points.map((point,k) => <g key={k}>
              {k % 5 === 0 && <line x1={cx} y1={cy} x2={point.x} y2={point.y} className="allocation-spoke chart-mark" style={delay(index * .14 + k * .012)}/>}
              <circle cx={point.x} cy={point.y} r={point.radius} data-allocation-unit="true" className="allocation-point chart-mark" style={delay(index * .14 + k * .012)}/>
            </g>)}
            <circle cx={cx} cy={cy} r={2.4} className="allocation-core chart-mark" style={delay(index * .14)}/>
            <text x={cx} y={cy! + edge + 15} textAnchor="middle" className="allocation-cluster-label chart-mark" style={delay(.5 + index * .12)}>{`${String(index+1).padStart(2,'0')} · ${share(row)}`}</text>
          </g>;
        })}
      </svg>
      <ol className="allocation-legend">{rows.map((row,index) => <li key={row.projectId} className={row.unallocated ? 'is-unallocated' : undefined} style={shade(index,row)} data-minutes={row.minutes}>
        <span className="allocation-legend-index">{String(index+1).padStart(2,'0')}</span>
        <strong>{row.title}</strong><span className="allocation-legend-values">{time(row)}<small>{share(row)}</small></span>
      </li>)}</ol>
      <p className="allocation-unit-note">散点按百分比取整，时长不作分摊。</p>
    </div>}
  </section>;
}

/**
 * G3 Chunky Bars / glance-gallery.html / “Revenue by plan”.
 *
 * Monument subtasks are a direct duration comparison, so the product keeps
 * the gallery's solid zero-origin bar instead of exposing a ruler/tick scale.
 * L2 Dot Cascade and F5 Tick Rows were considered but would imply countable
 * units that historical shared records cannot honestly provide.
 */
export function MonumentFocusChart({ rows }: { rows:MonumentTaskRow[] }) {
  const reveal = useChartReveal();
  const headingId = `monument-focus-chart-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const maximum = Math.max(0, ...rows.map(row => row.minutes));
  return <section className="focus-chart monument-focus-chart" ref={reveal.ref} data-chart-template="G3" aria-labelledby={headingId}>
    <div className="stats-section-heading"><div><h3 id={headingId}>旗下小任务投入</h3><p>条长从零开始，按可追溯实际时间比较</p></div></div>
    {rows.length === 0 || maximum <= 0 ? <p className="chart-empty">暂时没有可追溯的小任务投入。</p> : <ol key={reveal.revision} className={`monument-task-bars${reveal.revision ? ' is-revealed' : ''}`}>
      {rows.map((row,index) => {
        const extent = maximum > 0 ? row.minutes / maximum * ALLOCATION_BAR_WIDTH : 0;
        return <li key={row.subtaskId}>
          <div className="monument-task-heading"><strong title={row.title}>{row.title}</strong><span>{formatFocusMinutes(row.minutes)}{row.share === null ? '' : ` · ${row.share}%`}</span></div>
          <svg viewBox={`0 0 ${ALLOCATION_BAR_WIDTH} ${ALLOCATION_BAR_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`${row.title} · ${formatFocusMinutes(row.minutes)}${row.share === null ? '' : ` · ${row.share}%`}`}>
            <rect className="monument-bar-track" width={ALLOCATION_BAR_WIDTH} height={ALLOCATION_BAR_HEIGHT} rx={ALLOCATION_BAR_HEIGHT / 2}/>
            <path className="monument-bar-fill chart-mark" data-minutes={row.minutes} data-extent={extent} style={delay(index * .08)} d={allocationBarPath(extent)}/>
          </svg>
        </li>;
      })}
    </ol>}
  </section>;
}

export function formatFocusMinutes(minutes:number):string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${minutes} 分钟`;
}
