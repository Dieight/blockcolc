import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApplicationCommand, ApplicationService } from '@blockcolc/application';
import { completedPomodorosOn, dailyGoalForDate, localDateOf } from '@blockcolc/domain';
import { PixelCheck, PixelEdit, PixelClose, PixelFlag, PixelSprout } from './ui/PixelIcon';
import { PixelProgress } from './ui/PixelProgress';
import { PhysicalSlider } from './ui/PhysicalSlider';
import { HolidayEmblem } from './ui/HolidayEmblem';
import { useBackLayer } from './back-layer';

export function goalSliderCommand(date: string, rounds: number): ApplicationCommand {
  if (!Number.isInteger(rounds) || rounds < 0 || rounds > 20) throw new Error('Goal slider outside 0–20 rounds');
  return rounds === 0 ? { type: 'DisableDailyGoal', date } : { type: 'SetDailyGoal', date, targetPomodoros: rounds };
}

export function DailyGoalControl({ state, run, onViewReward }: {
  state: ReturnType<ApplicationService['snapshot']>;
  run: (command: ApplicationCommand) => Promise<boolean>;
  onViewReward: (projectId: string) => void;
}) {
  const date = localDateOf(new Date(), state.calendar.timeZone), goal = dailyGoalForDate(state, date);
  const completed = useMemo(() => completedPomodorosOn(state, date), [date, state]);
  const reward = state.decorationRewards.find(candidate => candidate.date === date);
  const rewardName = reward ? state.decorationBlueprintResources.find(resource => resource.id === reward.resourceId)?.blueprint.title ?? '今日装饰' : null;
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [target, setTarget] = useState(goal.enabled ? goal.targetPomodoros : 0);
  const [preview, setPreview] = useState<number | null>(null);
  const busy = useRef(false), opener = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null), closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setTarget(goal.enabled ? goal.targetPomodoros : 0); setPreview(null); }, [date, goal.targetPomodoros, goal.enabled, open]);
  const close = (restoreFocus = true) => {
    if (busy.current) return;
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => opener.current?.focus());
  };
  useBackLayer(open, () => { close(); return true; });
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const items = [...(sheetRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href]') ?? [])];
      const first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); sheetRef.current?.focus(); }
      else if (!sheetRef.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [open]);
  const save = async (rounds: number) => {
    if (busy.current) return;
    setTarget(rounds); setError('');
    if ((rounds === 0 && !goal.enabled) || (rounds === goal.targetPomodoros && goal.enabled)) return;
    busy.current = true; setPending(true);
    try {
      const command: ApplicationCommand = rounds > 20 && rounds === goal.targetPomodoros
        ? { type: 'SetDailyGoal', date, targetPomodoros: rounds }
        : goalSliderCommand(date, rounds);
      if (!await run(command)) setError('保存今日目标失败，请重试。');
    } catch { setError('保存今日目标失败，请重试。'); }
    finally { busy.current = false; setPending(false); }
  };
  return <>
    <section className="daily-goal daily-goal-workbench task-surface" aria-labelledby="daily-goal-title">
      <div className="daily-goal-summary"><div><h2 id="daily-goal-title">今日目标</h2><p>所有任务合计</p></div>
        <button ref={opener} type="button" className="daily-goal-adjust" aria-label="调整今日目标" onClick={() => { setError(''); setOpen(true); }}><PixelEdit/><span>调整</span></button></div>
      <div className="daily-goal-tally"><strong>{completed}{goal.enabled && <span> / {goal.targetPomodoros}</span>}</strong><span>{goal.enabled ? '轮已完成' : '轮 · 目标未开启'}</span></div>
      <div className="daily-goal-festival-line">{goal.enabled && <PixelProgress rounds className="daily-goal-progress" label={`今日 ${completed} / ${goal.targetPomodoros} 轮`} max={goal.targetPomodoros} value={completed}/>}<HolidayEmblem date={date} slot={1}/></div>
      {goal.enabled && completed < goal.targetPomodoros && <p className="daily-goal-hint"><PixelSprout/>再完成 {goal.targetPomodoros - completed} 轮，达成今日目标</p>}
      {rewardName && <span className="daily-goal-reward"><PixelCheck/>今日装饰已入库 · {rewardName}</span>}
      {goal.reachedAt && <span className="goal-reached"><PixelCheck/>今日已达成</span>}
    </section>
    {open && <div className="dialog-backdrop edge-sheet-backdrop daily-goal-sheet-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <section ref={sheetRef} className="daily-goal-sheet" role="dialog" aria-modal="true" aria-labelledby="daily-goal-sheet-title" aria-describedby="daily-goal-sheet-summary" aria-busy={pending} tabIndex={-1}>
        <div className="sheet-heading daily-goal-sheet-heading"><div><span className="eyebrow"><PixelFlag/>每日建造</span><h2 id="daily-goal-sheet-title">调整今日目标</h2></div>
          <button ref={closeRef} type="button" className="dialog-close" aria-label="关闭今日目标" disabled={pending} onClick={() => close()}><PixelClose/></button></div>
        <p id="daily-goal-sheet-summary" className="daily-goal-sheet-summary">{goal.enabled ? `今日已完成 ${completed} / ${goal.targetPomodoros} 轮` : `今日已完成 ${completed} 轮`}</p>
        <PixelProgress className="daily-goal-progress" value={completed} max={goal.targetPomodoros} rounds label="今日目标完成进度"/>
        <div className="daily-goal-controls">
          <div className="daily-goal-setting-row"><div className="daily-goal-setting-copy"><span id="daily-goal-enabled-label">开启今日目标</span><small>达成后获得今日装饰</small></div>
            <label className="switch-control ios-switch daily-goal-switch"><input type="checkbox" role="switch" aria-labelledby="daily-goal-enabled-label" checked={pending ? target > 0 : goal.enabled} disabled={pending} onChange={() => void save(goal.enabled ? 0 : goal.targetPomodoros)}/><span aria-hidden="true">{goal.enabled ? '已开启' : '已关闭'}</span></label></div>
          <div className="daily-goal-target-row"><div className="daily-goal-target-heading"><label htmlFor="daily-goal-target">目标轮数</label><output aria-live="polite">{preview === null ? '' : '预计 '}{preview ?? target} 轮</output></div>
            <PhysicalSlider id="daily-goal-target" label="今日目标次数" value={target} min={0} max={20} step={1} unit="轮" disabled={pending} commitOnRelease onPreviewChange={setPreview} onChange={rounds => void save(rounds)}/>
            <p className="daily-goal-sheet-note">{goal.targetPomodoros > 20 && goal.enabled ? `原目标 ${goal.targetPomodoros} 轮保留；调整范围 0–20 轮。` : '0 轮关闭目标；松手后保存。'}</p>
          </div>
        </div>
        {error && <p className="daily-goal-error" role="alert">{error}</p>}
        {reward && <div className="daily-goal-reward-panel"><span><PixelCheck/><b>今日装饰已入库</b><small>{rewardName}</small></span><button type="button" disabled={pending} onClick={() => { close(false); onViewReward(reward.projectId); }}>查看所在建筑</button></div>}
      </section>
    </div>}
  </>;
}
