import { useMemo, useRef, useState } from 'react';
import type { ApplicationCommand, ApplicationResult, ApplicationService } from '@tomato-clock/application';
import { Check } from 'lucide-react';
import { unsettledMarathonSessions } from './marathon-settlement';

export function ProgressReportV7({active,run,onSubmitted}:{active:NonNullable<ReturnType<ApplicationService['activeProjectProjection']>>;run:(c:ApplicationCommand)=>Promise<ApplicationResult>;onSubmitted:(sessionId:string)=>void}) {
  const session=active.unreportedCompletedSessions[0]!;
  const task=active.project.subtasks.find((subtask)=>subtask.id===session.subtaskId)!;
  const options=[task.progressBasisPoints,2500,5000,7500,10000].filter((value,index,all)=>value>=task.progressBasisPoints&&all.indexOf(value)===index);
  const submit=async(value:number)=>{const result=await run({type:'ReportSubtaskProgress',subtaskId:task.id,focusSessionIds:[session.id],progressBasisPoints:value});if(result?.ok)onSubmitted(session.id);};
  return <div className="report progress-report-panel"><Check/><span className="eyebrow">本轮已记录</span><h2>这次工作推进到哪里？</h2><p><strong>{task.title}</strong><br/>当前总进度 {Math.round(task.progressBasisPoints/100)}%。提交后会更新建筑的永久施工阶段。</p><div className="report-options">{options.map((value)=><button key={value} onClick={()=>void submit(value)}>{value===task.progressBasisPoints?`保持 ${value/100}%`:value===10000?'完成小任务':`推进至 ${value/100}%`}</button>)}</div></div>;
}

type MarathonReportCommand = Extract<ApplicationCommand, { type: 'ReportMarathonFocus' }>;

export interface TaskProgressSelectionState {
  choices: Record<string, number>;
  taskRounds: Record<string, number>;
}

/**
 * Keep the progress choice and its explicit round allocation together. A
 * current-value choice is meaningful: it records that the user wants the
 * finished round assigned without advancing the percentage.
 */
export function applyTaskProgressSelection(
  choices: Readonly<Record<string, number>>,
  taskRounds: Readonly<Record<string, number>>,
  subtaskId: string,
  value: number,
): TaskProgressSelectionState {
  const nextChoices = { ...choices };
  const nextTaskRounds = { ...taskRounds };
  if (nextChoices[subtaskId] === value) {
    delete nextChoices[subtaskId];
    delete nextTaskRounds[subtaskId];
  } else {
    nextChoices[subtaskId] = value;
  }
  return { choices: nextChoices, taskRounds: nextTaskRounds };
}

/**
 * Submit one settlement command and acknowledge it only after the command has
 * actually succeeded.  Keeping the duplicate guard here makes the failure
 * path testable without mounting the whole world screen: false results and
 * thrown persistence errors leave the draft retryable, while a second click
 * during an in-flight request is ignored.
 */
export async function submitMarathonReportOnce({
  busyRef,
  setBusy,
  canSubmit,
  run,
  command,
  onSubmitted,
}: {
  busyRef: { current: boolean };
  setBusy: (busy: boolean) => void;
  canSubmit: boolean;
  run: (command: MarathonReportCommand) => Promise<ApplicationResult>;
  command: MarathonReportCommand | null;
  onSubmitted: () => void;
}): Promise<'submitted' | 'failed' | 'ignored'> {
  if (busyRef.current || !canSubmit) return 'ignored';
  busyRef.current = true;
  setBusy(true);
  try {
    if (command !== null) {
      let result: ApplicationResult;
      try {
        result = await run(command);
      } catch {
        // The command runner already publishes the storage error.  Keep the
        // draft and let the user retry once that error is visible.
        return 'failed';
      }
      if (!result.ok) return 'failed';
    }
    onSubmitted();
    return 'submitted';
  } finally {
    busyRef.current = false;
    setBusy(false);
  }
}

// F19 marathon settlement report: after every scheduled round (or when the
// locked plan is cancelled) the user attributes completed rounds across ALL
// projects at once. Every stepper starts at zero. The command carries round
// counts, and the domain assigns the earliest completed sessions exactly once.
/**
 * A completed marathon round is settled once it has been consumed by a progress
 * report, a habit building, or an explicit settlement — it must never be offered
 * to a later settlement again. V23: this is what lets a "confirm then cancel"
 * plan return straight to the classic lane even after earlier rounds were
 * allocated to habits (the old code re-surfaced them as if unreported).
 */
export function MarathonProgressReport({ state, hostProjectId, run, onSubmitted }: {
  state: ReturnType<ApplicationService['snapshot']>;
  hostProjectId: string;
  run: (command: ApplicationCommand) => Promise<ApplicationResult>;
  onSubmitted: () => void;
}) {
  // Every round of this plan that still awaits settlement — completed or
  // early-completed marathon rounds that neither a previous settlement nor an
  // automatic report has consumed. Rounds settled by older versions are not
  // offered again, so the total shown is exactly the distributable pool.
  const sessions = unsettledMarathonSessions(state, hostProjectId);
  const totalRounds = sessions.length;
  const projects = state.projects.filter((project) =>
    project.status !== 'deleted' && project.kind === 'finite' && project.subtasks.some((subtask) => subtask.progressBasisPoints < 10000));
  const habits = state.projects.filter((project) =>
    project.status !== 'deleted' && project.kind === 'habit' && project.habit !== null && !project.habit.awaitingNextBuilding);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [habitRounds, setHabitRounds] = useState<Record<string, number>>({});
  const [taskRounds, setTaskRounds] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const toggleProject = (projectId: string) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    return next;
  });
  const subtaskProject = new Map<string, string>();
  const subtaskCurrent = new Map<string, number>();
  for (const project of projects) {
    for (const subtask of project.subtasks) {
      subtaskProject.set(subtask.id, project.id);
      subtaskCurrent.set(subtask.id, subtask.progressBasisPoints);
    }
  }
  const ownHabitMax = (project: typeof habits[number]): number => {
    const habit = project.habit!;
    return Math.max(0, Math.min(totalRounds, habit.targetRounds - habit.completedFocusSessionIds.length));
  };
  const allocatedHabitRounds = Object.values(habitRounds).reduce((sum, value) => sum + value, 0);
  const allocatedTaskRounds = Object.values(taskRounds).reduce((sum, value) => sum + value, 0);
  const allocatedRounds = allocatedHabitRounds + allocatedTaskRounds;
  const expandHabit = (projectId: string) => {
    if (!expanded.has(projectId)) {
      const next = new Set(expanded);
      next.add(projectId);
      setExpanded(next);
    } else {
      const next = new Set(expanded);
      next.delete(projectId);
      setExpanded(next);
    }
  };
  const stepHabit = (projectId: string, delta: number) => {
    const project = habits.find((item) => item.id === projectId);
    if (!project) return;
    const current = habitRounds[projectId] ?? 0;
    const others = allocatedRounds - current;
    const max = Math.max(0, Math.min(ownHabitMax(project), totalRounds - others));
    const nextValue = Math.max(0, Math.min(max, current + delta));
    setHabitRounds((previous) => {
      const next = { ...previous };
      if (nextValue === 0) delete next[projectId];
      else next[projectId] = nextValue;
      return next;
    });
  };
  const stepTask = (subtaskId: string, delta: number) => {
    const current = taskRounds[subtaskId] ?? 0;
    const others = allocatedRounds - current;
    const max = Math.max(0, totalRounds - others);
    const nextValue = Math.max(0, Math.min(max, current + delta));
    setTaskRounds(previous => {
      const next = { ...previous };
      if (nextValue === 0) delete next[subtaskId]; else next[subtaskId] = nextValue;
      return next;
    });
  };
  const selectTaskProgress = (subtaskId: string, value: number) => {
    const next = applyTaskProgressSelection(choices, taskRounds, subtaskId, value);
    setChoices(next.choices);
    setTaskRounds(next.taskRounds);
  };
  const optionsFor = (current: number) =>
    [current, 2500, 5000, 7500, 10000].filter((value, index, all) => value >= current && all.indexOf(value) === index);
  const entries = Object.entries(choices)
    .map(([subtaskId, progressBasisPoints]) => ({
      projectId: subtaskProject.get(subtaskId) ?? '',
      subtaskId,
      progressBasisPoints,
      rounds: taskRounds[subtaskId] ?? 0,
    }))
    .filter((entry) => entry.projectId !== '' && entry.progressBasisPoints >= (subtaskCurrent.get(entry.subtaskId) ?? 0) && entry.rounds > 0);
  const missingTaskRounds = Object.entries(choices).filter(([subtaskId, progressBasisPoints]) => progressBasisPoints > (subtaskCurrent.get(subtaskId) ?? 0) && (taskRounds[subtaskId] ?? 0) === 0).length;
  const orderedSessions = useMemo(() => [...sessions].sort((left, right) => {
    const leftEndedAt = left.status === 'interrupted' ? left.interruptedAt : left.completedAt;
    const rightEndedAt = right.status === 'interrupted' ? right.interruptedAt : right.completedAt;
    return Date.parse(leftEndedAt) - Date.parse(rightEndedAt) || left.id.localeCompare(right.id);
  }), [sessions]);
  const assignedMinutes = useMemo(() => {
    const result = new Map<string, number>();
    let habitOffset = 0;
    for (const [projectId, rounds] of Object.entries(habitRounds)) {
      result.set(`habit:${projectId}`, orderedSessions.slice(habitOffset, habitOffset + rounds).reduce((sum, session) => sum + session.actualDurationMs, 0));
      habitOffset += rounds;
    }
    let offset = allocatedHabitRounds;
    for (const entry of entries) {
      const assigned = orderedSessions.slice(offset, offset + entry.rounds);
      result.set(`task:${entry.subtaskId}`, assigned.reduce((sum, session) => sum + session.actualDurationMs, 0));
      offset += entry.rounds;
    }
    return result;
  }, [orderedSessions, allocatedHabitRounds, habitRounds, entries]);
  const hasTargets = projects.length > 0 || habits.length > 0;
  // V23: submitting with nothing allocated is valid — the remaining rounds (or
  // all rounds) are simply discarded instead of attributed to any task.
  const canSubmit = !busy && missingTaskRounds === 0 && allocatedRounds <= totalRounds;
  const submit = async () => {
    const habitAllocations = Object.entries(habitRounds)
      .map(([projectId, rounds]) => ({ projectId, rounds }))
      .filter((entry) => entry.rounds > 0);
    await submitMarathonReportOnce({
      busyRef,
      setBusy,
      canSubmit,
      run,
      command: totalRounds === 0 ? null : {
        type: 'ReportMarathonFocus',
        entries,
        habitAllocations,
        focusSessionIds: sessions.map((session) => session.id),
      },
      onSubmitted,
    });
  };
  return <div className="report progress-report-panel marathon-progress-report">
    <Check/>
    <span className="eyebrow">{totalRounds} 轮专注已结束</span>
    <h2>把这次推进汇报给哪些任务？</h2>
    <p>展开任务选择要推进的小任务，并为每个目标明确计入轮数；每轮只归属一个目标。习惯与普通任务共用同一轮次池，按最早完成顺序分配；没有分配的轮次会明确记为未分配。</p>
    {totalRounds === 0
      ? <p className="plan-sheet-note">这次没有需要汇报的轮次，直接结束计划即可。</p>
      : !hasTargets
        ? <p className="plan-sheet-note">没有可推进的任务：所有小任务都已完成，习惯建筑也都在等待选择下一座。直接结束计划即可。</p>
        : <div className="marathon-settlement-list">
            {habits.map((project) => {
              const habit = project.habit!;
              const rounds = habitRounds[project.id] ?? 0;
              return <section className="marathon-settlement-card" key={project.id}>
                <button type="button" className="marathon-settlement-head" aria-expanded={expanded.has(project.id)} onClick={() => expandHabit(project.id)}>
                  <span className="marathon-settlement-copy"><strong>{project.title}</strong><small>习惯 · 第 {habit.cycleNumber} 座建筑 · {habit.completedFocusSessionIds.length} / {habit.targetRounds} 轮</small></span>
                  <span className="marathon-settlement-toggle">{expanded.has(project.id) ? '收起' : '计入轮数'}</span>
                </button>
                {expanded.has(project.id) && <div className="marathon-settlement-body">
                  <RoundAllocationControl controlClassName="habit-round-stepper" value={rounds} max={Math.min(ownHabitMax(project), totalRounds - (allocatedRounds - rounds))} disabled={busy} onStep={(delta) => stepHabit(project.id, delta)} />
                  <small>{rounds > 0 ? `预计实际投入 ${formatMinutes(assignedMinutes.get(`habit:${project.id}`) ?? 0)}` : '默认 0 轮；展开不会自动分配'} · {allocatedRounds >= totalRounds ? '全部轮次已分配' : `还剩 ${totalRounds - allocatedRounds} 轮`}</small>
                </div>}
              </section>;
            })}
            {projects.map((project) => (
              <section className="marathon-settlement-card" key={project.id}>
                <button type="button" className="marathon-settlement-head" aria-expanded={expanded.has(project.id)} onClick={() => toggleProject(project.id)}>
                  <span className="marathon-settlement-copy"><strong>{project.title}</strong><small>{Math.round(project.subtasks.reduce((sum, subtask) => sum + subtask.progressBasisPoints, 0) / project.subtasks.length / 100)}% 总进度</small></span>
                  <span className="marathon-settlement-toggle">{expanded.has(project.id) ? '收起' : '展开'}</span>
                </button>
                {expanded.has(project.id) && <div className="marathon-settlement-body">
                  {project.subtasks.filter((subtask) => subtask.progressBasisPoints < 10000).map((subtask) => {
                    const current = subtask.progressBasisPoints;
                    const selectedProgress = choices[subtask.id];
                    const chosen = selectedProgress ?? current;
                    return <div className="marathon-report-row" key={subtask.id}>
                      <div className="marathon-report-copy"><strong>{subtask.title}</strong><small>当前 {Math.round(current / 100)}%（{Math.round(current / 100) === 0 ? '尚未推进' : '已有建筑进度'}）</small></div>
                      <div className="marathon-report-options">{optionsFor(current).map((value) => (
                         <button key={value} type="button" aria-pressed={selectedProgress === value} disabled={busy || (allocatedRounds >= totalRounds && chosen === current)} onClick={() => selectTaskProgress(subtask.id, value)}>{value === current ? `保持 ${value / 100}%` : value === 10000 ? '完成' : `推进至 ${value / 100}%`}</button>
                       ))}</div>
                       {selectedProgress !== undefined && <RoundAllocationControl controlClassName="task-round-stepper" value={taskRounds[subtask.id] ?? 0} max={totalRounds - (allocatedRounds - (taskRounds[subtask.id] ?? 0))} disabled={busy} targetLabel={subtask.title} actualMilliseconds={assignedMinutes.get(`task:${subtask.id}`)} onStep={(delta) => stepTask(subtask.id, delta)} />}
                    </div>;
                  })}
                </div>}
              </section>
            ))}
          </div>}
    {missingTaskRounds > 0 && <p className="plan-sheet-note" role="alert">已选择推进的小任务还没有计入轮数；请为每个目标至少增加 1 轮，或取消推进选择。</p>}
    {totalRounds > 0 && allocatedRounds === totalRounds && <p className="plan-sheet-note">全部轮次已明确分配，仍会一次性提交。</p>}
    {totalRounds > 0 && hasTargets && allocatedRounds < totalRounds && entries.length === 0 && <p className="plan-sheet-note">还有 {totalRounds - allocatedRounds} 轮未分配，可直接提交并明确记为未分配。</p>}
    <button type="button" className="primary marathon-report-submit" disabled={busy || (totalRounds > 0 && hasTargets && !canSubmit)} onClick={() => void submit()}>{totalRounds > 0 && hasTargets ? '一次提交本次推进' : '直接结束计划'}</button>
  </div>;
}

function formatMinutes(milliseconds:number):string {
  const minutes = Math.round(milliseconds / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${minutes} 分钟`;
}

function RoundAllocationControl({
  controlClassName,
  value,
  disabled,
  max,
  onStep,
  actualMilliseconds,
  targetLabel,
}: {
  controlClassName: string;
  value: number;
  disabled?: boolean;
  max: number;
  onStep: (delta: number) => void;
  actualMilliseconds?: number;
  /** Keep the habit control's short accessible names for existing callers. */
  targetLabel?: string;
}) {
  const buttonLabel = (verb: string) => targetLabel ? `${verb} ${targetLabel} 计入轮数` : `${verb}计入轮数`;
  return <div className={`time-stepper round-allocation-control ${controlClassName}`} role="group" aria-label={targetLabel ? `${targetLabel}轮次分配` : '轮次分配'}>
    <span className="round-allocation-label">计入轮数</span>
    <button type="button" aria-label={buttonLabel('减少')} disabled={Boolean(disabled) || value === 0} onClick={() => onStep(-1)}>−</button>
    <strong aria-label={targetLabel ? `${targetLabel} 计入轮数` : '计入轮数'}>{value}</strong>
    <button type="button" aria-label={buttonLabel('增加')} disabled={Boolean(disabled) || value >= max} onClick={() => onStep(1)}>+</button>
    <span className="round-allocation-meta">轮{value > 0 && actualMilliseconds !== undefined ? ` · 实际 ${formatMinutes(actualMilliseconds)}` : ''}</span>
  </div>;
}
