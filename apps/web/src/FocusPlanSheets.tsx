import { useState } from 'react';
import type { FocusInterruptionCategory } from '@blockcolc/domain';
import { PixelClose as X, PixelClock, PixelFlag, PixelMinus, PixelPlus, PixelPlay } from './ui/PixelIcon';
import { ChoiceMenu } from './ChoiceMenu';
import { marathonEndInstant } from './marathon-end-time';
import { MAX_MARATHON_ROUNDS, planRoundsForDuration } from './round-plan';
import { formatClockTime, formatDurationSummary } from './focus-format';

const CANCEL_REASONS: ReadonlyArray<{ value: FocusInterruptionCategory; label: string }> = [
  { value: 'external-interruption', label: '外部打扰' }, { value: 'task-blocked', label: '任务受阻' },
  { value: 'fatigue', label: '需要休息' }, { value: 'priority-changed', label: '优先级变化' },
  { value: 'device-or-app', label: '设备或应用问题' }, { value: 'other', label: '其他' },
];

function PlanMode({mode,locked,onChange}: {mode:'rounds'|'marathon';locked:boolean;onChange:(mode:'rounds'|'marathon')=>void}) {
  return <div className="plan-mode" role="group" aria-label="排程方式">
    <button type="button" aria-pressed={mode==='rounds'} disabled={locked} onClick={()=>onChange('rounds')}><PixelFlag/>固定轮次</button>
    <button type="button" aria-pressed={mode==='marathon'} disabled={locked} onClick={()=>onChange('marathon')}><PixelClock/>按结束时间</button>
  </div>;
}

function RoundChoices({rounds,locked,habit=false,onChange}: {rounds:number;locked:boolean;habit?:boolean;onChange:(rounds:number)=>void}) {
  return <div className="round-picker" aria-label={habit?'习惯专注轮数':'专注轮数'}><span>计划轮数</span><div>{[1,2,3,4].map(value=><button key={value} type="button" aria-pressed={rounds===value} disabled={locked} onClick={()=>onChange(value)}>
    <span><strong>{value}</strong> 轮</span><span className="plan-round-pixels" aria-hidden="true">{Array.from({length:value},(_,index)=><i key={index}/>)}</span>
  </button>)}</div></div>;
}

function CancelPlanReason({ onCancelPlan, initialNote = '', initialReason = null }: { onCancelPlan: (reason: FocusInterruptionCategory | null, note: string) => Promise<boolean>; initialNote?: string; initialReason?: FocusInterruptionCategory | null }) {
  const [reason, setReason] = useState<FocusInterruptionCategory | ''>(initialReason ?? '');
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="cancel-plan-reason">
    <label>取消原因<select aria-label="取消原因" required value={reason} disabled={busy} onChange={event => setReason(event.target.value as FocusInterruptionCategory | '')}>
      <option value="">选择原因</option>{CANCEL_REASONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
    <label>补充说明<textarea required maxLength={200} rows={3} value={note} disabled={busy} onChange={event => setNote(event.target.value)} placeholder="简短写下结束计划的原因"/></label>
    <p className="plan-sheet-note">已完成的完整轮次会保留并进入汇报；当前未完成轮次会按中断记录。最多 200 字。</p>
    {error && <p className="plan-sheet-error" role="alert">{error} 计划仍保留，可修改后重试。</p>}
    <button type="button" className="primary destructive" disabled={busy || !reason || !note.trim()} onClick={() => {
      if (!reason || !note.trim() || busy) return;
      setBusy(true); setError('');
      void (async () => { try { if (!await onCancelPlan(reason, note.trim())) setError('取消未完成，请重试。'); } catch { setError('保存失败，请重试。'); } finally { setBusy(false); } })();
    }}>{busy ? '正在保存…' : '确认取消整个计划'}</button>
  </div>;
}

export function FocusPlanSheet({ subtasks, selectedId, rounds, focusMinutes, breakMinutes, locked, mode, endAtDraft, onModeChange, onEndAtDraftChange, onSelect, onRoundsChange, onClose, onConfirm, onCancelPlan, cancellationNote, cancellationReason }: {
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
  onCancelPlan: (reason: FocusInterruptionCategory | null, note: string) => Promise<boolean>;
  cancellationNote?: string;
  cancellationReason?: FocusInterruptionCategory | null;
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
      <div className="sheet-heading"><div><span className="eyebrow">本次计划</span><h2 id="focus-plan-title"><PixelClock/>安排下一轮</h2></div><button type="button" className="dialog-close" aria-label="关闭本次计划" onClick={onClose}><X/></button></div>
      <PlanMode mode={mode} locked={locked} onChange={onModeChange}/>
      {mode === 'rounds' ? <>
        <ChoiceMenu label="本次专注" value={selectedId} disabled={locked} onChange={onSelect} options={subtasks.map((subtask) => ({ id: subtask.id, label: subtask.title, detail: `已完成 ${Math.round(subtask.progressBasisPoints / 100)}%` }))}/>
        <RoundChoices rounds={rounds} locked={locked} onChange={onRoundsChange}/>
        <p className="plan-sheet-note">每轮 {focusMinutes} 分钟专注{breakMinutes > 0 ? `；多轮之间休息 ${breakMinutes} 分钟。` : '；休息已关闭。'}{note}</p>
      </> : <>
        {/* 时、分按键更新同一个 HH:mm 草稿，沿用原排程计算。 */}
        <div className="marathon-end-picker" role="group" aria-label="结束时间">
          <div className="time-stepper"><span>时</span><button type="button" aria-label="减少结束小时" disabled={locked} onClick={() => stepEndTime(-60)}><PixelMinus/></button><strong aria-label="结束小时">{pad2(draftHour)}</strong><button type="button" aria-label="增加结束小时" disabled={locked} onClick={() => stepEndTime(60)}><PixelPlus/></button></div>
          <span className="time-colon" aria-hidden="true">:</span>
          <div className="time-stepper"><span>分</span><button type="button" aria-label="减少结束分钟" disabled={locked} onClick={() => stepEndTime(-5)}><PixelMinus/></button><strong aria-label="结束分钟">{pad2(draftMinute)}</strong><button type="button" aria-label="增加结束分钟" disabled={locked} onClick={() => stepEndTime(5)}><PixelPlus/></button></div>
        </div>
        {endMs === null
          ? <p className="plan-sheet-error">请先选择结束时间。</p>
          : schedule === null
            ? <p className="plan-sheet-error">从现在到 {formatClockTime(endMs)} 不足一轮专注（{focusMinutes} 分钟），请选择更晚的时间。</p>
            : <p className="plan-sheet-note">到 {formatClockTime(endMs)} 共约 {Math.max(1, Math.round((endMs - Date.now()) / 60000))} 分钟：安排 {schedule.rounds} 轮专注{schedule.breaks > 0 ? `、${schedule.breaks} 次休息` : ''}，全部结束后再统一汇报推进了哪些小任务。{capped ? `时间超过上限 ${MAX_MARATHON_ROUNDS} 轮，按前 ${schedule.rounds} 轮（约 ${formatDurationSummary(schedule.usableMs)}）排程。` : ''}{note}</p>}
      </>}
      {locked ? <CancelPlanReason onCancelPlan={onCancelPlan} initialNote={cancellationNote} initialReason={cancellationReason}/> : <button type="button" className="primary plan-confirm" disabled={mode === 'marathon' && !marathonValid} onClick={onConfirm}><PixelPlay/>确认计划</button>}
    </section>
  </div>;
}

export function HabitFocusPlanSheet({ rounds, focusMinutes, breakMinutes, locked, mode, endAtDraft, onModeChange, onEndAtDraftChange, onRoundsChange, onClose, onConfirm, onCancelPlan, cancellationNote, cancellationReason }: {
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
  onCancelPlan: (reason: FocusInterruptionCategory | null, note: string) => Promise<boolean>;
  cancellationNote?: string;
  cancellationReason?: FocusInterruptionCategory | null;
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
      <div className="sheet-heading"><div><span className="eyebrow">本次计划</span><h2 id="habit-focus-plan-title"><PixelClock/>安排习惯专注</h2></div><button type="button" className="dialog-close" aria-label="关闭本次计划" onClick={onClose}><X/></button></div>
      <PlanMode mode={mode} locked={locked} onChange={onModeChange}/>
      {mode === 'rounds' ? <>
        <RoundChoices rounds={rounds} locked={locked} habit onChange={onRoundsChange}/>
        <p className="plan-sheet-note">每轮 {focusMinutes} 分钟专注{breakMinutes > 0 ? `；多轮之间休息 ${breakMinutes} 分钟。` : '；休息已关闭。'}每个完成或提前完成的轮次都会推进当前建筑。{note}</p>
      </> : <>
        {/* 时、分按键更新同一个 HH:mm 草稿，沿用原排程计算。 */}
        <div className="marathon-end-picker" role="group" aria-label="结束时间">
          <div className="time-stepper"><span>时</span><button type="button" aria-label="减少结束小时" disabled={locked} onClick={() => stepEndTime(-60)}><PixelMinus/></button><strong aria-label="结束小时">{pad2(draftHour)}</strong><button type="button" aria-label="增加结束小时" disabled={locked} onClick={() => stepEndTime(60)}><PixelPlus/></button></div>
          <span className="time-colon" aria-hidden="true">:</span>
          <div className="time-stepper"><span>分</span><button type="button" aria-label="减少结束分钟" disabled={locked} onClick={() => stepEndTime(-5)}><PixelMinus/></button><strong aria-label="结束分钟">{pad2(draftMinute)}</strong><button type="button" aria-label="增加结束分钟" disabled={locked} onClick={() => stepEndTime(5)}><PixelPlus/></button></div>
        </div>
        {endMs === null
          ? <p className="plan-sheet-error">请先选择结束时间。</p>
          : schedule === null
            ? <p className="plan-sheet-error">从现在到 {formatClockTime(endMs)} 不足一轮习惯专注（{focusMinutes} 分钟），请选择更晚的时间。</p>
            : <p className="plan-sheet-note">到 {formatClockTime(endMs)} 共约 {Math.max(1, Math.round((endMs - Date.now()) / 60000))} 分钟：以普通任务设置的 {focusMinutes} 分钟为一轮，安排 {schedule.rounds} 轮习惯专注{schedule.breaks > 0 ? `、${schedule.breaks} 次休息` : ''}。每轮完成后直接推进当前建筑，结束后不进入普通任务的统一汇报。{capped ? `时间超过上限 ${MAX_MARATHON_ROUNDS} 轮，按前 ${schedule.rounds} 轮（约 ${formatDurationSummary(schedule.usableMs)}）排程。` : ''}{note}</p>}
      </>}
      {locked ? <CancelPlanReason onCancelPlan={onCancelPlan} initialNote={cancellationNote} initialReason={cancellationReason}/> : <button type="button" className="primary plan-confirm" disabled={mode === 'marathon' && !marathonValid} onClick={onConfirm}><PixelPlay/>确认计划</button>}
    </section>
  </div>;
}
