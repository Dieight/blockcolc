import type { ApplicationService, ProjectWorldProjection } from '@tomato-clock/application';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { focusSessionLocalDate } from './focus-stats';

type AppState = ReturnType<ApplicationService['snapshot']>;

export interface BuildingMemory {
  projectId: string;
  title: string;
  statusLabel: string;
  isActive: boolean;
  isMonument: boolean;
  blueprintLabel: string;
  completionPercent: number;
  constructionStage: string;
  conditionLabel: string;
  focusMinutes: number;
  completedRounds: number;
  lastFocusDate: string | null;
  nextStep: string | null;
}

export function createBuildingMemory(
  state: AppState,
  projection: ProjectWorldProjection,
  blueprintLabel: string,
): BuildingMemory {
  const project = state.projects.find((candidate) => candidate.id === projection.project.id);
  const habitMonument = state.habitBuildings.find((candidate) => candidate.id === projection.project.id);
  const monumentSessionIds = habitMonument ? new Set(habitMonument.focusSessionIds) : null;
  const sessions = state.focusHistory.filter((session) => monumentSessionIds
    ? monumentSessionIds.has(session.id)
    : session.projectId === projection.project.id);
  const lastFocus = sessions.length > 0 ? sessions[sessions.length - 1]! : null;
  const nextSubtask = project?.kind === 'finite'
    ? project.subtasks.find((subtask) => subtask.progressBasisPoints < 10_000)
    : null;
  const nextStep = nextSubtask
    ? nextSubtask.title
    : project?.kind === 'habit' && project.habit
      ? project.habit.awaitingNextBuilding
        ? '选择下一座习惯建筑'
        : `完成本周期第 ${Math.min(project.habit.completedFocusSessionIds.length + 1, project.habit.targetRounds)} / ${project.habit.targetRounds} 轮`
      : null;

  return {
    projectId: projection.project.id,
    title: projection.project.title,
    statusLabel: projection.project.status === 'monument' ? '纪念建筑' : projection.isActive ? '正在建造' : '暂停建造',
    isActive: projection.isActive,
    isMonument: projection.project.status === 'monument',
    blueprintLabel,
    completionPercent: Math.round(projection.building.completionBasisPoints / 100),
    constructionStage: constructionStage(projection.building.completionBasisPoints),
    conditionLabel: conditionMemoryLabel(projection.building.conditionBasisPoints),
    focusMinutes: Math.round(sessions.reduce((sum, session) => sum + session.actualDurationMs, 0) / 60_000),
    completedRounds: sessions.filter((session) => session.status === 'completed' || session.status === 'completed-early').length,
    lastFocusDate: lastFocus ? focusSessionLocalDate(lastFocus) : null,
    nextStep,
  };
}

export function BuildingMemoryPanel({
  memory,
  switchBlockedReason,
  onClose,
  onContinue,
}: {
  memory: BuildingMemory;
  switchBlockedReason?: string;
  onClose: () => void;
  onContinue: () => void;
}) {
  const titleId = `building-memory-${memory.projectId}`;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [memory.projectId, onClose]);

  return <div className="building-memory-layer" role="presentation" onPointerDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="building-memory-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header>
      <div>
        <span>建筑记忆</span>
        <h2 id={titleId}>{memory.title}</h2>
      </div>
      <button ref={closeRef} type="button" className="building-memory-close" aria-label="关闭建筑记忆" onClick={onClose}><X /></button>
    </header>
    <div className="building-memory-progress">
      <div><strong>{memory.completionPercent}%</strong><span>{memory.statusLabel} · {memory.conditionLabel}</span></div>
      <div className="meter" aria-label={`建造进度 ${memory.completionPercent}%`}><i style={{ width: `${memory.completionPercent}%` }} /></div>
      <small>{memory.blueprintLabel} · {memory.constructionStage}</small>
    </div>
    <dl>
      <div><dt>累计有效专注</dt><dd>{memory.focusMinutes > 0 ? `${memory.focusMinutes} 分钟` : '尚无记录'}</dd></div>
      <div><dt>有效完成轮次</dt><dd>{memory.completedRounds} 轮</dd></div>
      <div><dt>最近一次专注</dt><dd>{memory.lastFocusDate ?? '尚无记录'}</dd></div>
    </dl>
    {memory.nextStep && <p className="building-memory-next"><span>下一步</span><strong>{memory.nextStep}</strong></p>}
    {!memory.isMonument && <button type="button" className="building-memory-action" disabled={Boolean(switchBlockedReason)} onClick={onContinue}>
      {memory.isActive ? '继续专注' : '继续这个任务'}
    </button>}
    {switchBlockedReason && <p className="building-memory-blocked" role="status">{switchBlockedReason}</p>}
    {memory.isMonument && <p className="building-memory-monument">这栋建筑已完成，会作为聚落记忆永久保留。</p>}
  </section></div>;
}

export function conditionLabel(value: number) {
  return value >= 8_000 ? '完整' : value >= 5_000 ? '风化' : '破损';
}

function conditionMemoryLabel(value: number) {
  return value >= 8_000 ? '保存完整' : value >= 5_000 ? '已有风化' : '需要修复';
}

export function constructionStage(progress: number) {
  if (progress <= 0) return '场地准备';
  if (progress < 1_800) return '地基施工';
  if (progress < 3_800) return '框架与地板';
  if (progress < 6_500) return '墙体施工';
  if (progress < 8_800) return '屋顶施工';
  return progress < 10_000 ? '门窗与收尾' : '建筑已完成';
}
