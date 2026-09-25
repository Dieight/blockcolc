import { useCallback, useEffect, useMemo, useState } from 'react';
import { projectFocusAttribution, projectMonumentFocus, type ApplicationService, type MonumentFocusProjection, type UnallocatedFocusProjection } from '@tomato-clock/application';
import { addLocalDays, localDateOf } from '@tomato-clock/domain';
import { effectiveFocusMillisecondsByDate, focusSessionCountByDate, focusWindowSummary, projectFocusAllocation } from './focus-stats';
import { AchievementUnlockDialog, AchievementsSection, type AchievementEntry } from './ui/AchievementsPanel';
import { FocusAllocationChart, FocusCalendarChart, formatFocusMinutes, MonumentFocusChart } from './ui/FocusStatsCharts';

type AppState = ReturnType<ApplicationService['snapshot']>;
const PERIODS = [{days:1,label:'今天'}, {days:7,label:'近 7 天'}, {days:30,label:'近 30 天'}, {days:90,label:'近 90 天'}] as const;
const ACHIEVEMENT_RECEIPT_KEY = 'blockcolc-achievement-display-receipts-v1';

export interface AchievementReceiptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AchievementReceiptRead {
  seen: Set<string>;
  corrupt: boolean;
}

/** A corrupt receipt is recoverable data, not a reason to lock the dialog. */
export function readAchievementReceipt(storage: AchievementReceiptStorage): AchievementReceiptRead {
  try {
    const raw = storage.getItem(ACHIEVEMENT_RECEIPT_KEY);
    if (raw === null) return { seen: new Set(), corrupt: false };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'string')) return { seen: new Set(), corrupt: true };
    return { seen: new Set(parsed), corrupt: false };
  } catch {
    return { seen: new Set(), corrupt: true };
  }
}

export function writeAchievementReceipt(storage: AchievementReceiptStorage, ids: Iterable<string>): boolean {
  try {
    storage.setItem(ACHIEVEMENT_RECEIPT_KEY, JSON.stringify([...new Set(ids)]));
    return true;
  } catch {
    return false;
  }
}

export function reconcileAchievementBatch(
  previous: ReadonlyArray<AchievementEntry>,
  current: ReadonlyArray<AchievementEntry>,
  seen: ReadonlySet<string>,
  sessionDismissed: ReadonlySet<string>,
): ReadonlyArray<AchievementEntry> {
  const unlocked = new Map(current.filter(entry => entry.unlocked).map(entry => [entry.id, entry]));
  const merged = new Map(previous
    .filter(entry => unlocked.has(entry.id) && !sessionDismissed.has(entry.id))
    .map(entry => [entry.id, unlocked.get(entry.id)!]));
  for (const entry of current) {
    if (entry.unlocked && !seen.has(entry.id) && !sessionDismissed.has(entry.id)) merged.set(entry.id, entry);
  }
  return [...merged.values()];
}

export function StatsScreen({ state, achievementEntries, active = false }: { state:AppState; achievementEntries?:ReadonlyArray<AchievementEntry>; active?:boolean }) {
  const [period, setPeriod] = useState<number>(30);
  const today = localDateOf(new Date(), state.calendar.timeZone);
  const summary = useMemo(() => focusWindowSummary(state,today,period),[state,today,period]);
  const allocation = useMemo(() => {
    const all = projectFocusAllocation(state,today,period);
    if (all.length <= 6) return all;
    const unallocated = all.find(row => row.unallocated);
    const allocated = all.filter(row => !row.unallocated);
    const visibleAllocatedCount = unallocated ? 4 : 5;
    const visible = allocated.slice(0, visibleAllocatedCount);
    const hidden = allocated.slice(visibleAllocatedCount);
    const other = hidden.length > 0
      ? [{ projectId:'other', title:`其他 ${hidden.length} 项任务`, minutes:hidden.reduce((sum,row) => sum + row.minutes,0), share:hidden.reduce((sum,row) => sum + row.share,0) }]
      : [];
    return [...visible, ...other, ...(unallocated ? [unallocated] : [])];
  },[state,today,period]);
  const monuments = useMemo(() => projectMonumentFocus(state), [state]);
  const unallocated = useMemo(() => projectFocusAttribution(state).unallocated, [state]);
  const [pendingAchievements, setPendingAchievements] = useState<ReadonlyArray<AchievementEntry>>([]);
  const [receiptError, setReceiptError] = useState('');
  const [sessionDismissedIds, setSessionDismissedIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!active || achievementEntries === undefined) return;
    const receipt = readAchievementReceipt(window.localStorage);
    setPendingAchievements(previous => reconcileAchievementBatch(previous, achievementEntries, receipt.seen, sessionDismissedIds));
  }, [active, achievementEntries, sessionDismissedIds]);
  const dismissAchievements = useCallback(() => {
    if (!pendingAchievements.length) return;
    const current = readAchievementReceipt(window.localStorage);
    const ids = new Set(current.seen);
    for (const entry of pendingAchievements) ids.add(entry.id);
    if (writeAchievementReceipt(window.localStorage, ids)) {
      setReceiptError('');
      setPendingAchievements([]);
    } else {
      // A session-only acknowledgement is still a valid close action.  The
      // honest notice explains that a later visit may show the same historical
      // batch again because persistence failed.
      setSessionDismissedIds(previous => new Set([...previous, ...pendingAchievements.map(entry => entry.id)]));
      setReceiptError('展示回执未保存；本次已关闭，之后进入统计时可能再次提示。');
      setPendingAchievements([]);
    }
  }, [pendingAchievements]);
  const days = useMemo(() => {
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    const first = addLocalDays(today,-weekday - 25 * 7);
    const minutes = effectiveFocusMillisecondsByDate(state.focusHistory);
    const sessions = focusSessionCountByDate(state.focusHistory);
    return Array.from({length:26 * 7},(_,index) => {
      const date = addLocalDays(first,index);
      return {date,minutes:Math.round((minutes.get(date) ?? 0) / 60_000),sessions:sessions.get(date) ?? 0,future:date > today};
    });
  },[state.focusHistory,today]);
  const label = PERIODS.find(item => item.days === period)!.label;
  return <section className="page stats-page">
    <header className="stats-page-heading"><h1>专注轨迹</h1><p className="stats-intro">看看时间留下的痕迹。</p></header>
    <FocusCalendarChart days={days} today={today}/>
    <section className="stats-period-section" aria-label="按时间范围统计">
    <section className="stats-overview" aria-label="有效专注摘要">
      <div className="stats-periods" role="group" aria-label="统计时间范围">{PERIODS.map(item => <button type="button" key={item.days} aria-pressed={period === item.days} onClick={() => setPeriod(item.days)}>{item.label}</button>)}</div>
      <div className="stats-duration"><span>{label}有效专注</span><strong>{formatFocusMinutes(summary.minutes)}</strong></div>
      <div className="stats-key-facts"><div><strong>{summary.activeDays}</strong><span>活跃日</span></div><div><strong>{summary.completed + summary.early}</strong><span>有效完成轮次</span></div></div>
    </section>
    <FocusAllocationChart rows={allocation} rangeLabel={label}/>
    </section>
    <MonumentStatistics monuments={monuments} unallocated={unallocated}/>
    <AchievementsSection entries={achievementEntries}/>
    <p className="muted stats-note">仅保存在本机。时长包含中断前的实际投入；有效完成轮次包含完整与提前完成。日期沿用记录保存时的本地日期。</p>
    {receiptError && pendingAchievements.length === 0 && <p className="achievement-receipt-notice" role="status">{receiptError}</p>}
    {active && pendingAchievements.length > 0 && <AchievementUnlockDialog entries={pendingAchievements} error={receiptError} onDismiss={dismissAchievements}/>}
  </section>;
}

export function MonumentStatistics({ monuments, unallocated }: { monuments:readonly MonumentFocusProjection[]; unallocated:UnallocatedFocusProjection }) {
  return <details className="monument-statistics">
    <summary><span>纪念建筑</span><small>{monuments.length} 座已完成</small></summary>
    <p className="monument-intro">展示可追溯投入；旧记录单列，不估算分配。</p>
    {monuments.length === 0
      ? <p className="monument-empty">完成一项大型任务或习惯建筑后，这里会保留它的投入记忆。</p>
        : <div className="monument-list">{monuments.map(monument => {
          const sourceLabel = monument.source === 'habit' ? '已完成习惯建筑' : '已完成大型任务';
          // Native details owns the disclosure state. Leaving `open` out keeps
          // every card collapsed on entry and lets the browser close it again
          // without a React state race that could blank the stats route.
          return <details key={monument.id}>
            <summary><span><strong>{monument.title}</strong><small>{sourceLabel}{monument.expectedRounds !== null ? ` · ${monument.rounds} / ${monument.expectedRounds} 轮可追溯` : ` · ${monument.rounds} 轮可追溯`}{monument.interruptedRounds > 0 ? ` · ${monument.interruptedRounds} 条中断` : ''}</small></span><b>{formatFocusMinutes(monument.minutes)}</b></summary>
            <div className="monument-detail">
              <div className="monument-metrics"><div><span>实际投入</span><strong>{formatFocusMinutes(monument.minutes)}</strong></div><div><span>完成轮次</span><strong>{monument.rounds} 轮</strong></div><div><span>中断投入</span><strong>{monument.interruptedRounds > 0 ? `${monument.interruptedRounds} 条 · ${formatFocusMinutes(monument.interruptedMinutes)}` : '无'}</strong></div><div><span>完成时间</span><strong>{monument.completedAt ? new Date(monument.completedAt).toLocaleDateString('zh-CN') : '未知'}</strong></div></div>
             {monument.unknownRounds > 0 && <p className="monument-unknown" role="note">另有 {monument.unknownRounds} 条记录无法追溯{monument.unknownMinutes > 0 ? `（${formatFocusMinutes(monument.unknownMinutes)}）` : ''}，未分摊。</p>}
              <MonumentFocusChart rows={monument.subtasks}/>
            </div>
          </details>;
      })}</div>}
    {unallocated.rounds > 0 && <p className="monument-unallocated" role="note">另有 {[unallocated.completedRounds > 0 ? `${unallocated.completedRounds} 个完成轮次` : '', unallocated.interruptedRounds > 0 ? `${unallocated.interruptedRounds} 条中断记录` : ''].filter(Boolean).join('、')}未分配或无法追溯（共 {formatFocusMinutes(unallocated.minutes)}），未计入宿主任务或小任务占比。</p>}
  </details>;
}
