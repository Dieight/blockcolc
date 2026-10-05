import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { addLocalDays } from '@blockcolc/domain';
import { allocationPercentageUnits, allocationWeight } from '../focus-allocation-field';
import { focusHeatmapLevel, type FocusDateRange } from '../focus-stats';

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

/** F10 calendar layout; user-approved pixel-soft demo supplies fixed squares/bands. */
export function FocusCalendarChart({ days, today, selection, onSelectionChange, decoration }: {
  days:CalendarDay[]; today:string; selection:FocusDateRange; onSelectionChange:(range:FocusDateRange) => void; decoration?:ReactNode;
}) {
  const reveal = useChartReveal();
  const id = useId();
  const drag = useRef<{pointerId:number; anchor:string; before:FocusDateRange}|null>(null);
  const keyboardAnchor = useRef<string|null>(null);
  const [highlight,setHighlight]=useState<number|null>(null);
  const longest=days.filter(day=>!day.future&&day.minutes>0).reduce<CalendarDay|null>((best,day)=>!best||day.minutes>best.minutes?day:best,null);
  const first = days[0]?.date ?? today;
  const months = days.flatMap((day,index) => day.date.endsWith('-01') || index === 0 ? [{column:Math.floor(index / 7), label:`${Number(day.date.slice(5,7))}月`}] : [])
    .filter((month,index,list) => (list[index + 1]?.column ?? 26) - month.column >= 3);
  const x = (index:number) => 34 + Math.floor(index / 7) * 12;
  const y = (index:number) => 30 + index % 7 * 15;
  const clamp = (date:string) => date < first ? first : date > today ? today : date;
  const selectBetween = (anchor:string, end:string) => onSelectionChange(anchor <= end ? {start:anchor,end} : {start:end,end:anchor});
  const hitDate = (node:SVGSVGElement, clientX:number, clientY:number, outside = false) => {
    const bounds = node.getBoundingClientRect();
    const col = Math.round(((clientX - bounds.left) / bounds.width * 350 - 34) / 12);
    const row = Math.round(((clientY - bounds.top) / bounds.height * 145 - 30) / 15);
    if (!outside && (col < 0 || col >= 26 || row < 0 || row >= 7)) return null;
    const index = Math.min(25,Math.max(0,col)) * 7 + Math.min(6,Math.max(0,row));
    const day = days[index];
    return day && (!day.future || outside) ? clamp(day.date) : null;
  };
  const cancelDrag = () => {
    if (drag.current) { onSelectionChange(drag.current.before); drag.current = null; }
  };
  const dateLabel = (value:string) => `${Number(value.slice(0,4))}年${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日`;
  return <section className="focus-chart focus-heatmap-card" ref={reveal.ref} data-chart-template="F10" aria-labelledby="focus-heatmap-title">
    <h2 id="focus-heatmap-title" className="sr-only">过去 26 周的投入</h2>
    {decoration}
    <svg className={`focus-calendar-chart${reveal.revision ? ' is-revealed' : ''}`} viewBox="0 0 350 145" role="grid"
      tabIndex={0} aria-label="专注日历：点击一天，按住拖动选择多天。方向键切换，Shift 加方向键扩选，Escape 回到今天。"
      aria-multiselectable="true" aria-activedescendant={`${id}-${selection.end}`}
      onFocus={event => { if(event.currentTarget.dataset.selectionInput !== 'pointer') event.currentTarget.dataset.selectionInput='keyboard'; }}
      onBlur={event => { delete event.currentTarget.dataset.selectionInput; }}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return;
        event.currentTarget.dataset.selectionInput='pointer';
        const date = hitDate(event.currentTarget,event.clientX,event.clientY);
        if (!date) return;
        event.preventDefault(); event.currentTarget.dataset.selectionInput='pointer'; event.currentTarget.focus({preventScroll:true});
        drag.current = {pointerId:event.pointerId,anchor:date,before:selection};
        keyboardAnchor.current = null;
        event.currentTarget.setPointerCapture(event.pointerId);
        onSelectionChange({start:date,end:date});
      }}
      onPointerMove={event => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const date = hitDate(event.currentTarget,event.clientX,event.clientY,true);
        if (date) selectBetween(drag.current.anchor,date);
      }}
      onPointerUp={event => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const date = hitDate(event.currentTarget,event.clientX,event.clientY,true);
        if (date) selectBetween(drag.current.anchor,date);
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={event => { if(drag.current?.pointerId===event.pointerId) cancelDrag(); }}
      onLostPointerCapture={event => { if(drag.current?.pointerId===event.pointerId) cancelDrag(); }}
      onKeyDown={event => {
        event.currentTarget.dataset.selectionInput='keyboard';
        const offset = {ArrowLeft:-7,ArrowRight:7,ArrowUp:-1,ArrowDown:1}[event.key];
        if (offset !== undefined) {
          event.preventDefault();
          const anchor = keyboardAnchor.current ?? selection.end;
          const cursor = selection.start < anchor ? selection.start : selection.end;
          const next = clamp(addLocalDays(event.shiftKey ? cursor : selection.end,offset));
          if (event.shiftKey) { keyboardAnchor.current = anchor; selectBetween(anchor,next); }
          else { keyboardAnchor.current = null; onSelectionChange({start:next,end:next}); }
        } else if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault(); keyboardAnchor.current = null;
          drag.current = null;
          const next = event.key === 'Home' ? first : today;
          onSelectionChange({start:next,end:next});
        }
      }}>
      {months.map(month => <text key={month.column} x={34 + month.column * 12} y={12} className="chart-axis chart-month">{month.label}</text>)}
      {['一','二','三','四','五','六','日'].map((day,index) => <text key={day} x={18} y={33 + index * 15} textAnchor="end" className="chart-axis">{day}</text>)}
      {days.map((day,index) => {
        const selected = !day.future && day.date >= selection.start && day.date <= selection.end;
        const level=day.future?0:focusHeatmapLevel(day.minutes);
        return <g key={day.date} id={`${id}-${day.date}`} role="gridcell" aria-selected={selected} aria-disabled={day.future}
          data-date={day.date} data-minutes={day.future ? undefined : day.minutes} data-future={day.future || undefined} data-level={day.future ? 0 : focusHeatmapLevel(day.minutes)}
          data-highlight={highlight===null?undefined:level===highlight?'match':'dim'} data-longest={highlight===4&&day===longest||undefined}
          className="calendar-day">
          <title>{day.future ? `${dateLabel(day.date)} · 尚未到来` : `${dateLabel(day.date)} · ${formatFocusMinutes(Math.round(day.minutes))} · ${day.sessions} 次`}</title>
          <rect className="calendar-day-hit" x={x(index)-6} y={y(index)-7.5} width={12} height={15} fill="transparent"/>
          <rect className="calendar-pixel" x={x(index)-4} y={y(index)-4} width={8} height={8}/>
          {highlight===4&&day===longest&&<path className="calendar-longest-mark" d={`M${x(index)-3} ${y(index)-8}h6l-3 -4z`} aria-hidden="true"/>}
        </g>;
      })}
    </svg>
    <div className="calendar-legend" aria-label="热力图时长档位">{['0–3H','3–6H','6–9H','9–12H'].map((label,index) => <button type="button" key={label} aria-label={`高亮 ${label}`} aria-pressed={highlight===index+1} onClick={()=>setHighlight(previous=>previous===index+1?null:index+1)}><i data-level={index+1}/>{label}</button>)}</div>
    {highlight===4&&longest&&<p className="calendar-longest-label" role="status">最长一天 · {dateLabel(longest.date)} · {formatFocusMinutes(Math.round(longest.minutes))}</p>}
    <p className="calendar-gesture-hint">按住拖动，可选多天</p>
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
  const centers = rows.map((_,index) => [rows.length === 1 || (rows.length % 2 && index === rows.length-1) ? 200 : index % 2 ? 295 : 105, 100 + Math.floor(index / 2) * 175]);
  const height = 200 + Math.max(0,Math.ceil(rows.length / 2)-1) * 175;
  const rnd = (i:number,k:number) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;
  const shade = (index:number,row:AllocationRow):CSSProperties => ({ '--allocation-ink':row.unallocated ? 'var(--chart-faint)' : ['var(--chart-data)','var(--chart-data-mid)','var(--chart-data-soft)','var(--chart-muted)','color-mix(in srgb,var(--chart-data) 50%,var(--chart-paper))','var(--chart-ink)'][index % 6] } as CSSProperties);
  const share = (row:AllocationRow) => {
    const value = total > 0 ? allocationWeight(row) / total * 100 : 0;
    return value > 0 && value < 1 ? '<1%' : `${Number(value.toFixed(1))}%`;
  };
  const time = (row:AllocationRow) => allocationWeight(row) > 0 && row.minutes === 0 ? '不足 1 分钟' : formatFocusMinutes(row.minutes);
  return <section className="focus-chart project-allocation" ref={reveal.ref} data-chart-template="L14" aria-labelledby="project-allocation-title">
    <div className="stats-section-heading"><div><h2 id="project-allocation-title">时间花在了哪里</h2></div></div>
    {total === 0 ? <p className="chart-empty">开始一次专注，投入会在这里留下记录。</p> : <div key={`${rangeLabel}-${reveal.revision}`} className={`allocation-field${reveal.revision ? ' is-revealed' : ''}`}>
      <svg className="allocation-constellation" viewBox={`0 0 400 ${height}`} role="img" aria-label={`${rangeLabel}专注时间占比。${rows.map(row => `${row.title} · ${time(row)} · ${share(row)}`).join('；')}。每个像素约为总投入的 1%，文字显示实际时间。`}>
        {centers.slice(0,rows.length).slice(1).map(([x,y],index) => <line key={index} x1={centers[index]![0]} y1={centers[index]![1]} x2={x} y2={y} className="allocation-link chart-mark" style={delay(.9 + index * .1)}/>)}
        {rows.map((row,index) => {
          const [cx,cy] = centers[index]!;
          const points = Array.from({length:units[index]!},(_,k) => {
            const angle = (k * 137.508 + index * 55) * Math.PI / 180;
            const radius = 4 + Math.sqrt(k) * 5.9 + rnd(k+1,index+2) * 3;
            return {x:cx! + radius * Math.cos(angle), y:cy! + radius * Math.sin(angle), radius:1.5 + rnd(k+2,index+3) * 1.7};
          });
          return <g key={row.projectId} style={shade(index,row)} data-project-id={row.projectId} data-percentage-units={units[index]}>
            <title>{`${row.title} · ${time(row)} · ${share(row)}`}</title>
            {points.map((point,k) => <g key={k}>
              {k % 5 === 0 && <line x1={cx} y1={cy} x2={point.x} y2={point.y} className="allocation-spoke chart-mark" style={delay(index * .14 + k * .012)}/>}
              <rect x={point.x-point.radius} y={point.y-point.radius} width={point.radius*2} height={point.radius*2} data-allocation-unit="true" className="allocation-point chart-mark" style={delay(index * .14 + k * .012)}/>
            </g>)}
            <rect x={cx!-2.4} y={cy!-2.4} width={4.8} height={4.8} className="allocation-core chart-mark" style={delay(index * .14)}/>
            <text x={cx} y={cy!-78} textAnchor="middle" className="allocation-cluster-name">
              <tspan x={cx}>{[...row.title].slice(0,11).join('')}</tspan>
              {row.title.length>11 && <tspan x={cx} dy={14}>{[...row.title].slice(11,21).join('')}{row.title.length>21 ? '…' : ''}</tspan>}
            </text>
            <text x={cx} y={cy!+76} textAnchor="middle" className="allocation-cluster-time">{time(row)}</text>
          </g>;
        })}
      </svg>
      <ol className="allocation-legend sr-only">{rows.map((row,index) => <li key={row.projectId} className={row.unallocated ? 'is-unallocated' : undefined} style={shade(index,row)} data-minutes={row.minutes}>
        <span className="allocation-legend-index">{String(index+1).padStart(2,'0')}</span>
        <strong>{row.title}</strong><span className="allocation-legend-values">{time(row)}<small>{share(row)}</small></span>
      </li>)}</ol>
      <p className="allocation-unit-note">每个像素约占 1%；文字为实际投入。</p>
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
