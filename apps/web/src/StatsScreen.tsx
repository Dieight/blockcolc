import { useEffect, useRef, useState } from 'react';
import type { ApplicationService } from '@tomato-clock/application';
import { addLocalDays, isPlannedFocusDay, localDateOf } from '@tomato-clock/domain';
import {
  effectiveFocusMillisecondsByDate,
  focusHeatmapLevel,
  focusHourDistribution,
  focusSessionCountByDate,
  focusSessionEndedAt,
  focusSessionLocalDate,
  focusWindowSummary,
  projectFocusAllocation,
  settlementTotals,
} from './focus-stats';

type AppState = ReturnType<ApplicationService['snapshot']>;
const PROJECT_COLORS = ['#276749', '#4d8f60', '#167a72', '#a0652b', '#5b7a99', '#6b6f4b'] as const;
const INTERRUPTION_LABELS = new Map([
  ['external-interruption', '外部打扰'], ['task-blocked', '任务受阻'], ['fatigue', '需要休息'],
  ['priority-changed', '优先级变化'], ['device-or-app', '设备或应用问题'], ['other', '其他'],
  ['integrity-limit', '切屏次数上限'], ['unclassified', '未记录'],
]);

export function StatsScreen({ state }: { state: AppState }) {
  const week = periodStats(state, 'week');
  const heatmap = focusHeatmapStats(state);
  const today = localDateOf(new Date(), state.calendar.timeZone);
  const recent7 = focusWindowSummary(state, today, 7);
  const previous7 = focusWindowSummary(state, addLocalDays(today, -7), 7);
  const recent30 = focusWindowSummary(state, today, 30);
  const allocationAll = projectFocusAllocation(state, today, 30);
  const allocation = allocationAll.slice(0, 5);
  const otherMinutes = allocationAll.slice(5).reduce((sum, item) => sum + item.minutes, 0);
  const allocationTotal = allocationAll.reduce((sum, item) => sum + item.minutes, 0);
  const weeklyDelta = recent7.minutes - previous7.minutes;
  const hours = focusHourDistribution(state, today, 90);
  const peakHours = Math.max(...hours.map((bucket) => bucket.minutes), 0);
  const peak = peakHours > 0 ? hours.reduce((best, bucket) => bucket.minutes > best.minutes ? bucket : best, hours[0]!) : null;
  const totals = settlementTotals(state);
  const projectTitles = new Map(state.projects.map((project) => [project.id, project.title]));
  const colorIndexByProject = new Map<string, number>();
  allocationAll.forEach((item, index) => colorIndexByProject.set(item.projectId, index));
  let nextColorIndex = allocationAll.length;
  const hourProjectIds = [...new Set(hours.flatMap((bucket) => bucket.projects.map((entry) => entry.projectId)))];
  for (const projectId of hourProjectIds) if (!colorIndexByProject.has(projectId)) colorIndexByProject.set(projectId, nextColorIndex++);
  const colorFor = (projectId: string) => PROJECT_COLORS[(colorIndexByProject.get(projectId) ?? 0) % PROJECT_COLORS.length]!;

  return <section className="page stats-page">
    <h1>专注轨迹</h1><p className="stats-intro">所有数据只保存在本机；中断前的有效投入同样计入。</p>
    <FocusHeatmap heatmap={heatmap} />
    <section className="stats-overview" aria-labelledby="stats-overview-title">
      <div className="stats-section-heading"><div><h2 id="stats-overview-title">本周</h2><p>从周一到今天的记录</p></div><span>{formatFocusMinutes(week.minutes)}</span></div>
      <div className="stats-grid">
        <div className="stats-duration"><strong>{formatFocusMinutes(week.minutes)}</strong><span>有效专注时长</span></div>
        <div><strong>{week.completed}</strong><span>完整轮次</span></div>
        <div><strong>{week.early}</strong><span>提前完成</span></div>
        <div><strong>{week.activeDays}</strong><span>活跃天数</span></div>
      </div>
      <div className="stats-detail-line" aria-label="本周记录详情"><span><b>{week.completed + week.early}</b> 次有效完成</span><span><b>{week.interrupted}</b> 次中断</span><span><b>{week.rate}%</b> 完成率</span></div>
    </section>
    <section className="stats-rhythm" aria-labelledby="stats-rhythm-title"><div className="stats-section-heading"><div><h2 id="stats-rhythm-title">近期专注</h2><p>回顾近 7 天与近 30 天的有效专注时长。</p></div></div><div className="rhythm-grid"><div><span>近 7 天</span><strong>{formatFocusMinutes(recent7.minutes)}</strong><small>{recent7.activeDays} 个活跃日</small></div><div><span>近 30 天</span><strong>{formatFocusMinutes(recent30.minutes)}</strong><small>{recent30.activeDays} 个活跃日</small></div></div><p className="rhythm-comparison">{weeklyDelta === 0 ? '与此前 7 天的有效专注时长相近' : `比此前 7 天${weeklyDelta > 0 ? '多' : '少'}专注 ${formatFocusMinutes(Math.abs(weeklyDelta))}`}</p></section>
    <section className="focus-hour-card" aria-labelledby="focus-hour-title"><div className="stats-section-heading"><div><h2 id="focus-hour-title">专注时段</h2><p>近 90 天有效专注按结束时刻的分布</p></div>{peak && <span>高峰 {peak.hour}:00 前后</span>}</div><div className="focus-hour-chart" role="img" aria-label={peak ? `近 90 天按小时的有效专注分布，高峰在 ${peak.hour} 点前后` : '近 90 天还没有有效专注记录'}>{hours.map((bucket) => <div key={bucket.hour} className="focus-hour-column" title={`${bucket.hour}:00 前后 · 有效专注 ${bucket.minutes} 分钟`}>{bucket.projects.map((entry) => <i key={entry.projectId} style={{ height: `${Math.max(2, Math.round(entry.minutes / Math.max(peakHours, 1) * 100))}%`, background: colorFor(entry.projectId) }} />)}</div>)}</div><div className="focus-hour-axis" aria-hidden="true"><span>0时</span><span>6时</span><span>12时</span><span>18时</span><span>23时</span></div>{hourProjectIds.length > 0 && <ul className="focus-hour-legend">{hourProjectIds.map((projectId) => <li key={projectId}><i style={{ background: colorFor(projectId) }} />{projectTitles.get(projectId) ?? '已移除任务'}</li>)}</ul>}</section>
    <section className="project-allocation" aria-labelledby="project-allocation-title"><div className="stats-section-heading"><div><h2 id="project-allocation-title">项目投入</h2><p>近 30 天有效专注时长</p></div>{allocationTotal > 0 && <span>{formatFocusMinutes(allocationTotal)}</span>}</div>{allocationAll.length === 0 ? <p>还没有可分配的有效投入。</p> : <><div className="allocation-bar" role="img" aria-label={`近 30 天项目投入：${allocation.map((item) => `${item.title} ${formatFocusMinutes(item.minutes)}`).join('，')}${otherMinutes > 0 ? `，其他 ${formatFocusMinutes(otherMinutes)}` : ''}`}>{allocation.map((item) => <i key={item.projectId} style={{ width: `${item.minutes / allocationTotal * 100}%`, background: colorFor(item.projectId) }} title={`${item.title} · ${formatFocusMinutes(item.minutes)} · ${Math.round(item.minutes / allocationTotal * 100)}%`} />)}{otherMinutes > 0 && <i className="allocation-other" style={{ width: `${otherMinutes / allocationTotal * 100}%` }} title={`其他 · ${formatFocusMinutes(otherMinutes)} · ${Math.round(otherMinutes / allocationTotal * 100)}%`} />}</div><ul className="allocation-legend">{allocation.map((item) => <li key={item.projectId}><i style={{ background: colorFor(item.projectId) }} /><div><strong>{item.title}</strong><span>{formatFocusMinutes(item.minutes)} · {Math.round(item.minutes / allocationTotal * 100)}%</span></div></li>)}{otherMinutes > 0 && <li><i className="allocation-other" /><div><strong>其他</strong><span>{formatFocusMinutes(otherMinutes)} · {Math.round(otherMinutes / allocationTotal * 100)}%</span></div></li>}</ul></>}</section>
    <section className="interruption-summary focus-hour-card" aria-labelledby="interruption-summary-title"><h2 id="interruption-summary-title">本周中断原因</h2><p className="interruption-note">共 {week.interrupted} 次中断</p>{week.reasons.length === 0 ? <p>这个周期没有已归类的中断。</p> : <ul className="interruption-list">{week.reasons.map((reason) => <li key={reason.value}><div><span>{reason.label}</span><strong>{reason.count} 次{week.interrupted > 0 ? ` · ${Math.round(reason.count / week.interrupted * 100)}%` : ''}</strong></div><i className="interruption-bar"><b style={{ width: `${Math.max(6, reason.count / Math.max(week.interrupted, 1) * 100)}%` }} /></i></li>)}</ul>}</section>
    <section className="settlement-totals" aria-labelledby="settlement-totals-title"><div className="stats-section-heading"><div><h2 id="settlement-totals-title">聚落总览</h2><p>从第一天起累计</p></div></div><div className="settlement-rows"><div><span>累计有效专注</span><strong>{formatFocusMinutes(totals.totalMinutes)}</strong></div><div><span>有效轮次</span><strong>{totals.completedRounds}</strong></div><div><span>建成建筑</span><strong>{totals.buildings}</strong></div></div></section>
    <p className="muted stats-note">热力图按实际专注时长统计，完整、提前完成和中断前的有效时间都会计入。</p>
  </section>;
}

function FocusHeatmap({ heatmap }: { heatmap: ReturnType<typeof focusHeatmapStats> }) {
  const [tip, setTip] = useState<{ date: string; x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const openTip = (date: string, future: boolean, cell: HTMLElement) => {
    if (future) return;
    if (tip?.date === date) { setTip(null); return; }
    const rect = cell.getBoundingClientRect();
    setTip({ date, x: Math.max(10, Math.min(rect.left + rect.width / 2 - 88, window.innerWidth - 198)), y: Math.max(10, rect.top + rect.height + 6) });
  };
  useEffect(() => {
    if (!tip) return;
    const onPointerDown = (event: PointerEvent) => { if (cardRef.current && !cardRef.current.contains(event.target as Node)) setTip(null); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setTip(null); };
    window.addEventListener('pointerdown', onPointerDown); window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onPointerDown); window.removeEventListener('keydown', onKey); };
  }, [tip]);
  const days = heatmap.weeks.flatMap((week) => week.days);
  const selectedDay = tip ? days.find((day) => day.date === tip.date) : null;
  return <section className="focus-heatmap-card" ref={cardRef} aria-labelledby="focus-heatmap-title">
    <div className="stats-section-heading"><div><h2 id="focus-heatmap-title">近 26 周</h2><p>按有效专注时长着色，点格子看当天详情</p></div><span>{formatFocusMinutes(heatmap.totalMinutes)}</span></div>
    <div className="focus-heatmap-scroll"><div className="focus-heatmap"><div className="focus-heatmap-months" aria-hidden="true">{heatmap.months.map((month) => <span key={month.column} style={{ gridColumn: `${month.column} / span ${month.span}` }}>{month.label}</span>)}</div><div className="focus-heatmap-content"><div className="focus-heatmap-weekdays" aria-hidden="true"><span>一</span><span /><span>三</span><span /><span>五</span><span /><span /></div><div className="focus-heatmap-grid">{days.map((day) => {
      const label = `${heatmapDateLabel(day.date)}：有效专注 ${day.minutes} 分钟${day.sessions ? `，${day.sessions} 次` : '，无专注记录'}`;
      return <span key={day.date} role={day.future ? undefined : 'button'} tabIndex={day.future ? -1 : 0} aria-pressed={tip?.date === day.date || undefined} aria-label={day.future ? undefined : label} className={`focus-heatmap-cell heat-level-${day.level}${day.future ? ' is-future' : ''}${tip?.date === day.date ? ' is-selected' : ''}`} title={label} onClick={day.future ? undefined : (event) => openTip(day.date, day.future, event.currentTarget)} onKeyDown={day.future ? undefined : (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTip(day.date, day.future, event.currentTarget); } }} />;
    })}</div></div></div></div>
    {tip && selectedDay && <div className="focus-heatmap-tip" role="status" style={{ left: tip.x, top: tip.y }}><div className="focus-heatmap-tip-head"><strong>{heatmapDateLabel(selectedDay.date)}</strong><button type="button" className="focus-heatmap-tip-close" aria-label="关闭" onClick={() => setTip(null)}>×</button></div><div className="focus-heatmap-tip-row"><span>有效专注</span><strong>{formatFocusMinutes(selectedDay.minutes)}</strong></div><div className="focus-heatmap-tip-row"><span>专注次数</span><strong>{selectedDay.sessions > 0 ? `${selectedDay.sessions} 次` : '无记录'}</strong></div></div>}
    <div className="focus-heatmap-legend" aria-label="色阶：0、少于 90、90、180、270、360 分钟以上">{([['0', 0], ['<90', 1], ['90', 2], ['180', 3], ['270', 4], ['360+', 5]] as const).map(([label, level]) => <span className="heatmap-legend-item" key={level}><i className={`heat-level-${level}`} />{label}</span>)}</div>
  </section>;
}

function focusHeatmapStats(state: AppState) {
  const today = localDateOf(new Date(), state.calendar.timeZone);
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const firstDate = addLocalDays(today, -weekday - 25 * 7);
  const millisecondsByDate = effectiveFocusMillisecondsByDate(state.focusHistory);
  const sessionsByDate = focusSessionCountByDate(state.focusHistory);
  const weeks = Array.from({ length: 26 }, (_, weekIndex) => ({ days: Array.from({ length: 7 }, (_, dayIndex) => {
    const date = addLocalDays(firstDate, weekIndex * 7 + dayIndex);
    const minutes = Math.round((millisecondsByDate.get(date) ?? 0) / 60_000);
    return { date, minutes, future: date > today, level: focusHeatmapLevel(minutes), sessions: sessionsByDate.get(date) ?? 0 };
  }) }));
  const monthMarkers = weeks.flatMap((week, index) => {
    const day = week.days.find((candidate) => candidate.date.slice(-2) === '01') ?? (index === 0 ? week.days[0] : undefined);
    return day ? [{ column: index + 1, label: new Intl.DateTimeFormat('zh-CN', { month: 'short', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`)) }] : [];
  });
  const months = monthMarkers.map((month, index) => ({ ...month, span: (monthMarkers[index + 1]?.column ?? 27) - month.column })).filter((month) => month.span >= 2);
  const allDays = weeks.flatMap((week) => week.days).filter((day) => !day.future);
  return { weeks, months, totalMinutes: allDays.reduce((sum, day) => sum + day.minutes, 0), activeDays: allDays.filter((day) => day.minutes > 0).length };
}

function periodStats(state: AppState, period: 'week' | 'month' | 'year') {
  const now = new Date(); const start = new Date(now); let count = 7; let label = '本周';
  if (period === 'week') { const day = (now.getDay() + 6) % 7; start.setDate(now.getDate() - day); start.setHours(0, 0, 0, 0); }
  else if (period === 'month') { start.setDate(1); start.setHours(0, 0, 0, 0); count = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); label = '本月'; }
  else { start.setMonth(0, 1); start.setHours(0, 0, 0, 0); count = 12; label = '本年'; }
  const relevant = state.focusHistory.filter((session) => Date.parse(focusSessionEndedAt(session)) >= start.getTime());
  const completed = relevant.filter((session) => session.status === 'completed');
  const early = relevant.filter((session) => session.status === 'completed-early');
  const interrupted = relevant.filter((session) => session.status === 'interrupted');
  const successful = [...completed, ...early];
  const minutes = Math.round(relevant.reduce((sum, session) => sum + session.actualDurationMs, 0) / 60_000);
  const days = new Set(relevant.filter((session) => session.actualDurationMs > 0).map(focusSessionLocalDate));
  const bucketMilliseconds = Array.from({ length: count }, () => 0);
  for (const session of relevant) { const date = new Date(focusSessionEndedAt(session)); const index = period === 'year' ? date.getMonth() : period === 'month' ? date.getDate() - 1 : Math.floor((date.getTime() - start.getTime()) / 86_400_000); if (index >= 0 && index < bucketMilliseconds.length) bucketMilliseconds[index]! += session.actualDurationMs; }
  const buckets = bucketMilliseconds.map((value) => Math.round(value / 60_000));
  const reasonCounts = new Map<string, number>();
  for (const session of interrupted) { const key = session.interruptionReason === 'app-switch-limit' ? 'integrity-limit' : session.interruptionCategory ?? 'unclassified'; reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1); }
  const reasons = [...reasonCounts].map(([value, reasonCount]) => ({ value, label: INTERRUPTION_LABELS.get(value) ?? value, count: reasonCount })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'));
  return { completed: completed.length, early: early.length, interrupted: interrupted.length, minutes, activeDays: days.size, streak: plannedFocusStreak(state), rate: relevant.length ? Math.round(successful.length / relevant.length * 100) : 0, buckets, max: Math.max(1, ...buckets), label, reasons };
}

function plannedFocusStreak(state: AppState) {
  const successfulDates = new Set(state.focusHistory.filter((session) => session.status !== 'interrupted').map((session) => localDateOf(session.completedAt, state.calendar.timeZone)));
  const today = localDateOf(new Date(), state.calendar.timeZone);
  let cursor = today; let streak = 0;
  for (let scanned = 0; scanned < 3660; scanned += 1) {
    if (!isPlannedFocusDay(cursor, state.calendar)) { cursor = addLocalDays(cursor, -1); continue; }
    if (successfulDates.has(cursor)) { streak += 1; cursor = addLocalDays(cursor, -1); continue; }
    if (cursor === today) { cursor = addLocalDays(cursor, -1); continue; }
    break;
  }
  return streak;
}

function formatFocusMinutes(minutes: number) { return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${minutes} 分钟`; }
function heatmapDateLabel(date: string) { const [year, month, day] = date.split('-'); return `${year}年${Number(month)}月${Number(day)}日`; }
