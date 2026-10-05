import { useRef, useState } from 'react';
import type { FocusInterruptionCategory } from '@blockcolc/domain';
import { PixelClose as X, PixelClock, PixelFlag, PixelPlay } from './ui/PixelIcon';
import { MinimalClockGesture } from './ui/MinimalClockGesture';
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

function EndTimeChoice({ draft, endMs, focusMinutes, breakMinutes, locked, onChange }: {
  draft: string; endMs: number | null; focusMinutes: number; breakMinutes: number; locked: boolean; onChange: (draft: string) => void;
}) {
  return <div className="plan-end-time"><MinimalClockGesture confirmation="button" value={endMs} clockText={draft || '--:--'}
    busy={locked} focusMinutes={focusMinutes} breakMinutes={breakMinutes} onChange={value => {
      if (value === null) { onChange(''); return; }
      const date = new Date(value);
      onChange(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
    }}/></div>;
}

function CancelPlanReason({ onCancelPlan, initialNote = '', initialReason = null }: { onCancelPlan: (reason: FocusInterruptionCategory | null, note: string) => Promise<boolean>; initialNote?: string; initialReason?: FocusInterruptionCategory | null }) {
  const [reason, setReason] = useState<FocusInterruptionCategory | ''>(initialReason ?? '');
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  return <div className="cancel-plan-reason">
    <ChoiceMenu label="取消原因" value={reason} disabled={busy} options={[{id:'',label:'选择原因'},...CANCEL_REASONS.map(option => ({id:option.value,label:option.label}))]} onChange={value => setReason(value as FocusInterruptionCategory | '')}/>
    <label>补充说明（可选）<textarea maxLength={200} rows={3} value={note} disabled={busy} onChange={event => setNote(event.target.value)} placeholder="需要时再写"/></label>
    <p className="plan-sheet-note">保留已完成轮次，当前轮记为中断。最多 200 字。</p>
    {error && <p className="plan-sheet-error" role="alert">{error} 计划仍保留，可修改后重试。</p>}
    <button type="button" className="primary destructive" aria-busy={busy} disabled={busy || !reason} onClick={() => {
      if (!reason || busyRef.current) return;
      busyRef.current = true; setBusy(true); setError('');
      void (async () => { try { if (!await onCancelPlan(reason, note.trim())) setError('取消未完成，请重试。'); } catch { setError('保存失败，请重试。'); } finally { busyRef.current = false; setBusy(false); } })();
    }}>{busy ? '正在保存…' : '确认取消整个计划'}</button>
  </div>;
}

function ConfirmPlanAction({ disabled, onConfirm, label='确认计划', destructive=false }: { disabled: boolean; onConfirm: () => void | Promise<void>; label?:string;destructive?:boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  return <>
    <button type="button" className={`primary plan-confirm${destructive?' destructive':''}`} disabled={disabled || busy} aria-busy={busy} onClick={() => {
      if (disabled || pending.current) return;
      pending.current = true; setBusy(true); setError('');
      void (async () => { try { await onConfirm(); } catch { setError('计划未保存，请重试。'); } finally { pending.current = false; setBusy(false); } })();
    }}>{!destructive&&<PixelPlay/>}{label}</button>
    {error && <p className="plan-sheet-error" role="alert">{error}</p>}
  </>;
}

export function FocusPlanSheet({ subtasks, selectedId, rounds, focusMinutes, breakMinutes, locked, mode, endAtDraft, onModeChange, onEndAtDraftChange, onSelect, onRoundsChange, onClose, onConfirm, onCancelPlan, cancellationNote, cancellationReason, unstarted=false }: {
  subtasks: Array<{ id: string; title: string; progressBasisPoints: number }>;
  selectedId: string;
  rounds: number;
  focusMinutes: number;
  breakMinutes: number;
  locked: boolean;
  unstarted?:boolean;
  mode: 'rounds' | 'marathon';
  endAtDraft: string;
  onModeChange: (mode: 'rounds' | 'marathon') => void;
  onEndAtDraftChange: (draft: string) => void;
  onSelect: (id: string) => void;
  onRoundsChange: (rounds: number) => void;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  onCancelPlan: (reason: FocusInterruptionCategory | null, note: string) => Promise<boolean>;
  cancellationNote?: string;
  cancellationReason?: FocusInterruptionCategory | null;
}) {
  const endMs = mode === 'marathon' ? marathonEndInstant(endAtDraft) : null;
  const schedule = endMs === null ? null : planRoundsForDuration(endMs - Date.now(), focusMinutes, breakMinutes);
  const rawSchedule = endMs === null ? null : planRoundsForDuration(endMs - Date.now(), focusMinutes, breakMinutes, 1_000_000);
  const capped = schedule !== null && rawSchedule !== null && rawSchedule.rounds > schedule.rounds;
  const marathonValid = endMs !== null && schedule !== null;
  const note = locked ? ' 已锁定，可取消后重新安排。' : '';
  const available = subtasks.filter(subtask => subtask.progressBasisPoints < 10000);
  return <div className="dialog-backdrop plan-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="focus-plan-sheet" role="dialog" aria-modal="true" aria-labelledby="focus-plan-title">
      <div className="sheet-heading"><div><span className="eyebrow">本次计划</span><h2 id="focus-plan-title"><PixelClock/>安排下一轮</h2></div><button type="button" className="dialog-close" aria-label="关闭本次计划" onClick={onClose}><X/></button></div>
      <PlanMode mode={mode} locked={locked} onChange={onModeChange}/>
      {mode === 'rounds' ? <>
        <ChoiceMenu label="本次专注" value={available.some(subtask => subtask.id === selectedId) ? selectedId : available[0]?.id ?? ''} disabled={locked} onChange={onSelect} options={available.map((subtask) => ({ id: subtask.id, label: subtask.title, detail: `进度 ${Math.round(subtask.progressBasisPoints / 100)}%` }))}/>
        <RoundChoices rounds={rounds} locked={locked} onChange={onRoundsChange}/>
        <p className="plan-sheet-note">每轮 {focusMinutes} 分钟专注{breakMinutes > 0 ? `；多轮之间休息 ${breakMinutes} 分钟。` : '；休息已关闭。'}{note}</p>
      </> : <>
        <EndTimeChoice draft={endAtDraft} endMs={endMs} focusMinutes={focusMinutes} breakMinutes={breakMinutes} locked={locked} onChange={onEndAtDraftChange}/>
        {endMs === null
          ? <p className="plan-sheet-error">请先选择结束时间。</p>
          : schedule === null
            ? <p className="plan-sheet-error">从现在到 {formatClockTime(endMs)} 不足一轮专注（{focusMinutes} 分钟），请选择更晚的时间。</p>
            : <p className="plan-sheet-note">{schedule.rounds} 轮专注{schedule.breaks > 0 ? ` · ${schedule.breaks} 次休息` : ''} · 结束后统一汇报。{capped ? `最多 ${MAX_MARATHON_ROUNDS} 轮，约 ${formatDurationSummary(schedule.usableMs)}。` : ''}{note}</p>}
      </>}
      {locked ? unstarted ? <ConfirmPlanAction label="取消计划" destructive disabled={false} onConfirm={async()=>{if(!await onCancelPlan(null,''))throw new Error('取消未完成');}}/> : <CancelPlanReason onCancelPlan={onCancelPlan} initialNote={cancellationNote} initialReason={cancellationReason}/> : <ConfirmPlanAction disabled={mode === 'marathon' ? !marathonValid : available.length === 0} onConfirm={onConfirm}/>}
    </section>
  </div>;
}

export function HabitFocusPlanSheet({ rounds, focusMinutes, breakMinutes, locked, mode, endAtDraft, onModeChange, onEndAtDraftChange, onRoundsChange, onClose, onConfirm, onCancelPlan, cancellationNote, cancellationReason, unstarted=false }: {
  rounds: number;
  focusMinutes: number;
  breakMinutes: number;
  locked: boolean;
  unstarted?:boolean;
  mode: 'rounds' | 'marathon';
  endAtDraft: string;
  onModeChange: (mode: 'rounds' | 'marathon') => void;
  onEndAtDraftChange: (draft: string) => void;
  onRoundsChange: (rounds: number) => void;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  onCancelPlan: (reason: FocusInterruptionCategory | null, note: string) => Promise<boolean>;
  cancellationNote?: string;
  cancellationReason?: FocusInterruptionCategory | null;
}) {
  const endMs = mode === 'marathon' ? marathonEndInstant(endAtDraft) : null;
  const schedule = endMs === null ? null : planRoundsForDuration(endMs - Date.now(), focusMinutes, breakMinutes);
  const rawSchedule = endMs === null ? null : planRoundsForDuration(endMs - Date.now(), focusMinutes, breakMinutes, 1_000_000);
  const capped = schedule !== null && rawSchedule !== null && rawSchedule.rounds > schedule.rounds;
  const marathonValid = endMs !== null && schedule !== null;
  const note = locked ? ' 已锁定，可取消后重新安排。' : '';
  return <div className="dialog-backdrop plan-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="focus-plan-sheet" role="dialog" aria-modal="true" aria-labelledby="habit-focus-plan-title">
      <div className="sheet-heading"><div><span className="eyebrow">本次计划</span><h2 id="habit-focus-plan-title"><PixelClock/>安排习惯专注</h2></div><button type="button" className="dialog-close" aria-label="关闭本次计划" onClick={onClose}><X/></button></div>
      <PlanMode mode={mode} locked={locked} onChange={onModeChange}/>
      {mode === 'rounds' ? <>
        <RoundChoices rounds={rounds} locked={locked} habit onChange={onRoundsChange}/>
        <p className="plan-sheet-note">每轮 {focusMinutes} 分钟{breakMinutes > 0 ? ` · 休息 ${breakMinutes} 分钟` : ' · 不休息'}。完成即推进建筑。{note}</p>
      </> : <>
        <EndTimeChoice draft={endAtDraft} endMs={endMs} focusMinutes={focusMinutes} breakMinutes={breakMinutes} locked={locked} onChange={onEndAtDraftChange}/>
        {endMs === null
          ? <p className="plan-sheet-error">请先选择结束时间。</p>
          : schedule === null
            ? <p className="plan-sheet-error">从现在到 {formatClockTime(endMs)} 不足一轮习惯专注（{focusMinutes} 分钟），请选择更晚的时间。</p>
            : <p className="plan-sheet-note">{schedule.rounds} 轮习惯专注，每轮 {focusMinutes} 分钟{schedule.breaks > 0 ? ` · ${schedule.breaks} 次休息` : ''}。完成即推进建筑。{capped ? `最多 ${MAX_MARATHON_ROUNDS} 轮，约 ${formatDurationSummary(schedule.usableMs)}。` : ''}{note}</p>}
      </>}
      {locked ? unstarted ? <ConfirmPlanAction label="取消计划" destructive disabled={false} onConfirm={async()=>{if(!await onCancelPlan(null,''))throw new Error('取消未完成');}}/> : <CancelPlanReason onCancelPlan={onCancelPlan} initialNote={cancellationNote} initialReason={cancellationReason}/> : <ConfirmPlanAction disabled={mode === 'marathon' && !marathonValid} onConfirm={onConfirm}/>}
    </section>
  </div>;
}
