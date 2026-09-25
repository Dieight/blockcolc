import { X } from 'lucide-react';
import { ChoiceMenu } from './ChoiceMenu';
import { marathonEndInstant } from './marathon-end-time';
import { MAX_MARATHON_ROUNDS, planRoundsForDuration } from './round-plan';
import { formatClockTime, formatDurationSummary } from './focus-format';

export function FocusPlanSheet({ subtasks, selectedId, rounds, focusMinutes, breakMinutes, locked, mode, endAtDraft, onModeChange, onEndAtDraftChange, onSelect, onRoundsChange, onClose, onConfirm, onCancelPlan }: {
  subtasks: Array<{ id: string; title: string; progressBasisPoints: number }>;
  selectedId: string;
  rounds: number;
  focusMinutes: number;
  breakMinutes: number;
  locked: boolean;
  mode: 'rounds' | 'marathon';
  endAtDraft: string;
  onModeChange: (mode: 'rounds' | 'marathon') => void;
  onEndAtDraftChange: (draft: string) => void;
  onSelect: (id: string) => void;
  onRoundsChange: (rounds: number) => void;
  onClose: () => void;
  onConfirm: () => void;
  onCancelPlan: () => Promise<void>;
}) {
  const endMs = mode === 'marathon' ? marathonEndInstant(endAtDraft) : null;
  const schedule = endMs === null ? null : planRoundsForDuration(endMs - Date.now(), focusMinutes, breakMinutes);
  const rawSchedule = endMs === null ? null : planRoundsForDuration(endMs - Date.now(), focusMinutes, breakMinutes, 1_000_000);
  const capped = schedule !== null && rawSchedule !== null && rawSchedule.rounds > schedule.rounds;
  const marathonValid = endMs !== null && schedule !== null;
  const note = locked ? ' 当前计划已开始，只能取消整个计划；取消后可重新安排。' : '';
  // Custom end-time picker (hours/minutes steppers) styled to the app, replacing
  // the native time input that would pop the system picker on Android.
  const draftMatch = /^(\d{2}):(\d{2})$/.exec(endAtDraft);
  const draftHour = draftMatch ? Number(draftMatch[1]) : 0;
  const draftMinute = draftMatch ? Number(draftMatch[2]) : 0;
  const pad2 = (value: number) => String(value).padStart(2, '0');
  // 用户回滚指示：马拉松/极简结束时间统一回到点按步进选择器（不使用键盘输入；
  // 步进在 0..23/0..59 内循环，永远不会产生越界草稿）。
  const stepEndTime = (deltaMinutes: number) => {
    const total = (((draftHour * 60 + draftMinute + deltaMinutes) % 1440) + 1440) % 1440;
    onEndAtDraftChange(`${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`);
  };
  return <div className="dialog-backdrop plan-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="focus-plan-sheet" role="dialog" aria-modal="true" aria-labelledby="focus-plan-title">
      <div className="sheet-heading"><div><span className="eyebrow">本次计划</span><h2 id="focus-plan-title">安排下一轮</h2></div><button type="button" className="dialog-close" aria-label="关闭本次计划" onClick={onClose}><X/></button></div>
      <div className="plan-mode" role="group" aria-label="排程方式">
        <button type="button" aria-pressed={mode === 'rounds'} disabled={locked} onClick={() => onModeChange('rounds')}>固定轮次</button>
        <button type="button" aria-pressed={mode === 'marathon'} disabled={locked} onClick={() => onModeChange('marathon')}>按结束时间</button>
      </div>
      {mode === 'rounds' ? <>
        <ChoiceMenu label="本次专注" value={selectedId} disabled={locked} onChange={onSelect} options={subtasks.map((subtask) => ({ id: subtask.id, label: subtask.title, detail: `已完成 ${Math.round(subtask.progressBasisPoints / 100)}%` }))}/>
        <div className="round-picker" aria-label="专注轮数"><span>计划轮数</span><div>{[1, 2, 3, 4].map((value) => <button key={value} type="button" aria-pressed={rounds === value} disabled={locked} onClick={() => onRoundsChange(value)}>{value} 轮</button>)}</div></div>
        <p className="plan-sheet-note">每轮 {focusMinutes} 分钟专注{breakMinutes > 0 ? `；多轮之间休息 ${breakMinutes} 分钟。` : '；休息已关闭。'}{note}</p>
      </> : <>
        {/* DF-UI-07: shared end-time entry (same display component as the
         * minimal sheet). The draft keeps the app's padded HH:mm shape; an
         * empty keystroke is ignored instead of writing a fabricated zero. */}
        {/* 用户回滚指示：统一回到点按步进选择器 */}
        <div className="marathon-end-picker" role="group" aria-label="结束时间">
          <div className="time-stepper"><span>时</span><button type="button" aria-label="减少结束小时" disabled={locked} onClick={() => stepEndTime(-60)}>−</button><strong aria-label="结束小时">{pad2(draftHour)}</strong><button type="button" aria-label="增加结束小时" disabled={locked} onClick={() => stepEndTime(60)}>+</button></div>
          <span className="time-colon" aria-hidden="true">:</span>
          <div className="time-stepper"><span>分</span><button type="button" aria-label="减少结束分钟" disabled={locked} onClick={() => stepEndTime(-5)}>−</button><strong aria-label="结束分钟">{pad2(draftMinute)}</strong><button type="button" aria-label="增加结束分钟" disabled={locked} onClick={() => stepEndTime(5)}>+</button></div>
        </div>
        {endMs === null
          ? <p className="plan-sheet-error">请先选择结束时间。</p>
          : schedule === null
            ? <p className="plan-sheet-error">从现在到 {formatClockTime(endMs)} 不足一轮专注（{focusMinutes} 分钟），请选择更晚的时间。</p>
            : <p className="plan-sheet-note">到 {formatClockTime(endMs)} 共约 {Math.max(1, Math.round((endMs - Date.now()) / 60000))} 分钟：安排 {schedule.rounds} 轮专注{schedule.breaks > 0 ? `、${schedule.breaks} 次休息` : ''}，全部结束后再统一汇报推进了哪些小任务。{capped ? `时间超过上限 ${MAX_MARATHON_ROUNDS} 轮，按前 ${schedule.rounds} 轮（约 ${formatDurationSummary(schedule.usableMs)}）排程。` : ''}{note}</p>}
      </>}
      <button type="button" className={locked ? 'primary destructive' : 'primary'} disabled={!locked && mode === 'marathon' && !marathonValid} onClick={locked ? () => void onCancelPlan() : onConfirm}>{locked ? '取消计划' : '确认计划'}</button>
    </section>
  </div>;
}

export function HabitFocusPlanSheet({ rounds, focusMinutes, breakMinutes, locked, mode, endAtDraft, onModeChange, onEndAtDraftChange, onRoundsChange, onClose, onConfirm, onCancelPlan }: {
  rounds: number;
  focusMinutes: number;
  breakMinutes: number;
  locked: boolean;
  mode: 'rounds' | 'marathon';
  endAtDraft: string;
  onModeChange: (mode: 'rounds' | 'marathon') => void;
  onEndAtDraftChange: (draft: string) => void;
  onRoundsChange: (rounds: number) => void;
  onClose: () => void;
  onConfirm: () => void;
  onCancelPlan: () => void;
}) {
  const endMs = mode === 'marathon' ? marathonEndInstant(endAtDraft) : null;
  const schedule = endMs === null ? null : planRoundsForDuration(endMs - Date.now(), focusMinutes, breakMinutes);
  const rawSchedule = endMs === null ? null : planRoundsForDuration(endMs - Date.now(), focusMinutes, breakMinutes, 1_000_000);
  const capped = schedule !== null && rawSchedule !== null && rawSchedule.rounds > schedule.rounds;
  const marathonValid = endMs !== null && schedule !== null;
  const draftMatch = /^(\d{2}):(\d{2})$/.exec(endAtDraft);
  const draftHour = draftMatch ? Number(draftMatch[1]) : 0;
  const draftMinute = draftMatch ? Number(draftMatch[2]) : 0;
  const pad2 = (value: number) => String(value).padStart(2, '0');
  // 用户回滚指示：习惯单与普通单同用点按步进选择器（不会产生越界草稿）。
  const stepEndTime = (deltaMinutes: number) => {
    const total = (((draftHour * 60 + draftMinute + deltaMinutes) % 1440) + 1440) % 1440;
    onEndAtDraftChange(`${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`);
  };
  const note = locked ? ' 当前计划已开始，只能取消整个计划；取消后可重新安排。' : '';
  return <div className="dialog-backdrop plan-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="focus-plan-sheet" role="dialog" aria-modal="true" aria-labelledby="habit-focus-plan-title">
      <div className="sheet-heading"><div><span className="eyebrow">本次计划</span><h2 id="habit-focus-plan-title">安排习惯专注</h2></div><button type="button" className="dialog-close" aria-label="关闭本次计划" onClick={onClose}><X/></button></div>
      <div className="plan-mode" role="group" aria-label="排程方式">
        <button type="button" aria-pressed={mode === 'rounds'} disabled={locked} onClick={() => onModeChange('rounds')}>固定轮次</button>
        <button type="button" aria-pressed={mode === 'marathon'} disabled={locked} onClick={() => onModeChange('marathon')}>按结束时间</button>
      </div>
      {mode === 'rounds' ? <>
        <div className="round-picker" aria-label="习惯专注轮数"><span>计划轮数</span><div>{[1, 2, 3, 4].map((value) => <button key={value} type="button" aria-pressed={rounds === value} disabled={locked} onClick={() => onRoundsChange(value)}>{value} 轮</button>)}</div></div>
        <p className="plan-sheet-note">每轮 {focusMinutes} 分钟专注{breakMinutes > 0 ? `；多轮之间休息 ${breakMinutes} 分钟。` : '；休息已关闭。'}每个完成或提前完成的轮次都会推进当前建筑。{note}</p>
      </> : <>
        {/* DF-UI-07: shared end-time entry (same display component as the
         * minimal sheet). The draft keeps the app's padded HH:mm shape; an
         * empty keystroke is ignored instead of writing a fabricated zero. */}
        {/* 用户回滚指示：统一回到点按步进选择器 */}
        <div className="marathon-end-picker" role="group" aria-label="结束时间">
          <div className="time-stepper"><span>时</span><button type="button" aria-label="减少结束小时" disabled={locked} onClick={() => stepEndTime(-60)}>−</button><strong aria-label="结束小时">{pad2(draftHour)}</strong><button type="button" aria-label="增加结束小时" disabled={locked} onClick={() => stepEndTime(60)}>+</button></div>
          <span className="time-colon" aria-hidden="true">:</span>
          <div className="time-stepper"><span>分</span><button type="button" aria-label="减少结束分钟" disabled={locked} onClick={() => stepEndTime(-5)}>−</button><strong aria-label="结束分钟">{pad2(draftMinute)}</strong><button type="button" aria-label="增加结束分钟" disabled={locked} onClick={() => stepEndTime(5)}>+</button></div>
        </div>
        {endMs === null
          ? <p className="plan-sheet-error">请先选择结束时间。</p>
          : schedule === null
            ? <p className="plan-sheet-error">从现在到 {formatClockTime(endMs)} 不足一轮习惯专注（{focusMinutes} 分钟），请选择更晚的时间。</p>
            : <p className="plan-sheet-note">到 {formatClockTime(endMs)} 共约 {Math.max(1, Math.round((endMs - Date.now()) / 60000))} 分钟：以普通任务设置的 {focusMinutes} 分钟为一轮，安排 {schedule.rounds} 轮习惯专注{schedule.breaks > 0 ? `、${schedule.breaks} 次休息` : ''}。每轮完成后直接推进当前建筑，结束后不进入普通任务的统一汇报。{capped ? `时间超过上限 ${MAX_MARATHON_ROUNDS} 轮，按前 ${schedule.rounds} 轮（约 ${formatDurationSummary(schedule.usableMs)}）排程。` : ''}{note}</p>}
      </>}
      <button type="button" className={locked ? 'primary destructive' : 'primary'} disabled={!locked && mode === 'marathon' && !marathonValid} onClick={locked ? onCancelPlan : onConfirm}>{locked ? '取消计划' : '确认计划'}</button>
    </section>
  </div>;
}
