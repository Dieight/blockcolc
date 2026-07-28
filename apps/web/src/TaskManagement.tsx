import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApplicationCommand, ApplicationResult, ApplicationService } from '@tomato-clock/application';
import { localDateOf } from '@tomato-clock/domain';
import { ArrowDown, ArrowUp, Check, LockKeyhole, Pencil, Plus, Save, Trash2, X } from 'lucide-react';

type ActiveProject = NonNullable<ReturnType<ApplicationService['activeProjectProjection']>>;
type AppState = ReturnType<ApplicationService['snapshot']>;
type RunCommand = (command: ApplicationCommand) => Promise<ApplicationResult>;

export function TasksScreen({ active, state, run, onCreateProject }: { active: ActiveProject; state: AppState; run: RunCommand; onCreateProject: () => void }) {
  const [pending, setPending] = useState(false);
  const [projectTitle, setProjectTitle] = useState(active.project.title);
  const [editingProject, setEditingProject] = useState(false);
  const [newSubtask, setNewSubtask] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const locked = active.project.subtaskStructureLocked;
  const hasActiveFocus = state.activeFocusSession !== null;
  const unfinishedProjects = state.projects.filter(project => project.status === 'active' || project.status === 'paused');
  const switchBlocked = hasActiveFocus || active.unreportedCompletedSessions.length > 0;

  useEffect(() => {
    setProjectTitle(active.project.title);
    setEditingProject(false);
  }, [active.project.id, active.project.title]);

  const perform = async (command: ApplicationCommand) => {
    if (pending) return false;
    setPending(true);
    try {
      const result = await run(command);
      return result.ok;
    } catch {
      return false;
    } finally {
      setPending(false);
    }
  };

  const renameProject = async () => {
    const title = projectTitle.trim();
    if (!title || title === active.project.title) {
      setProjectTitle(active.project.title);
      setEditingProject(false);
      return;
    }
    if (await perform({ type: 'RenameProject', title })) setEditingProject(false);
  };

  const addSubtask = async () => {
    const title = newSubtask.trim();
    if (!title || locked) return;
    if (await perform({ type: 'AddSubtask', title })) setNewSubtask('');
  };

  const reorder = async (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= active.project.subtasks.length) return;
    const orderedSubtaskIds = active.project.subtasks.map((subtask) => subtask.id);
    [orderedSubtaskIds[index], orderedSubtaskIds[target]] = [orderedSubtaskIds[target]!, orderedSubtaskIds[index]!];
    await perform({ type: 'ReorderSubtasks', orderedSubtaskIds });
  };

  const removeSubtask = async () => {
    if (!deleteTarget || locked) return;
    if (await perform({ type: 'RemoveSubtask', subtaskId: deleteTarget.id })) setDeleteTarget(null);
  };

  const removeProject = async () => {
    if (hasActiveFocus) return;
    if (await perform({ type: 'DeleteActiveProject', projectId: active.project.id })) setDeleteProjectOpen(false);
  };

  return <section className="page tasks-page">
    <span className="eyebrow">大型任务</span>
    <div className="project-switcher">
      <label>当前大型任务<select aria-label="当前大型任务" value={active.project.id} disabled={pending || switchBlocked} onChange={event => void perform({ type: 'SwitchActiveProject', projectId: event.target.value })}>{unfinishedProjects.map(project => <option key={project.id} value={project.id}>{project.title} · {Math.round(project.subtasks.reduce((sum, subtask) => sum + subtask.progressBasisPoints, 0) / project.subtasks.length / 100)}%</option>)}</select></label>
      <button type="button" disabled={pending || switchBlocked} title={switchBlocked ? '请先结束或汇报当前专注' : '新增大型任务'} onClick={onCreateProject}><Plus/>新增大型任务</button>
    </div>
    <div className="task-project-title">
      {editingProject ? <>
        <label className="sr-only" htmlFor="project-title">大型任务名称</label>
        <input id="project-title" autoFocus value={projectTitle} disabled={pending} onChange={event => setProjectTitle(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter') void renameProject();
          if (event.key === 'Escape') { setProjectTitle(active.project.title); setEditingProject(false); }
        }}/>
        <IconButton label="保存大型任务名称" disabled={pending || !projectTitle.trim()} onClick={() => void renameProject()}><Check/></IconButton>
        <IconButton label="取消修改" disabled={pending} onClick={() => { setProjectTitle(active.project.title); setEditingProject(false); }}><X/></IconButton>
      </> : <>
        <h1>{active.project.title}</h1>
        <IconButton label="修改大型任务名称" disabled={pending} onClick={() => setEditingProject(true)}><Pencil/></IconButton>
      </>}
    </div>

    <DailyGoalControl state={state} run={perform}/>

    <div className="task-section-heading">
      <div><h2>小任务</h2><p>{active.project.subtasks.length} 项 · 等分建筑进度</p></div>
      {locked && <div className="structure-lock"><LockKeyhole/><span>已有进度后不能增删，可继续改名和排序。</span></div>}
    </div>

    <div className="task-editor-list">
      {active.project.subtasks.map((subtask, index) => {
        const hasHistory = state.activeFocusSession?.subtaskId === subtask.id
          || state.focusHistory.some(session => session.subtaskId === subtask.id)
          || state.progressReports.some(report => report.subtaskId === subtask.id);
        const canDelete = !locked && active.project.subtasks.length > 1 && !hasHistory;
        return <SubtaskRow
          key={subtask.id}
          id={subtask.id}
          title={subtask.title}
          progressBasisPoints={subtask.progressBasisPoints}
          index={index}
          count={active.project.subtasks.length}
          pending={pending}
          showDelete={!locked}
          canDelete={canDelete}
          deleteReason={locked ? '已有进度后不能删除' : active.project.subtasks.length === 1 ? '至少保留一个小任务' : hasHistory ? '已有专注记录的小任务不能删除' : ''}
          onRename={title => perform({ type: 'RenameSubtask', subtaskId: subtask.id, title })}
          onMove={offset => reorder(index, offset)}
          onDelete={() => setDeleteTarget({ id: subtask.id, title: subtask.title })}
        />;
      })}
    </div>

    {!locked && <div className="add-subtask">
      <label htmlFor="new-subtask">新增小任务</label>
      <div><input id="new-subtask" value={newSubtask} disabled={pending} placeholder="例如：整理验证结果" onChange={event => setNewSubtask(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addSubtask(); }}/><button type="button" disabled={pending || !newSubtask.trim()} onClick={() => void addSubtask()}><Plus/>添加</button></div>
    </div>}

    <section className="project-delete-zone" aria-labelledby="delete-project-title">
      <div><h2 id="delete-project-title">删除大型任务</h2><p>{hasActiveFocus ? '请先结束当前专注，才能删除大型任务。' : '删除前会自动创建本地回滚备份，可在设置中恢复。'}</p></div>
      <button type="button" className="danger-outline" title={hasActiveFocus ? '请先结束当前专注后再删除大型任务' : undefined} disabled={pending || hasActiveFocus} onClick={() => setDeleteProjectOpen(true)}><Trash2/>删除当前任务</button>
    </section>

    {deleteTarget && <ConfirmDialog
      title="删除这个小任务？"
      confirmLabel="删除小任务"
      pending={pending}
      onCancel={() => setDeleteTarget(null)}
      onConfirm={() => void removeSubtask()}
    >
      <p>“{deleteTarget.title}”将被永久删除，剩余小任务会重新等分建筑进度。此操作无法撤销。</p>
    </ConfirmDialog>}
    {deleteProjectOpen && <ConfirmDialog
      title="删除这项大型任务？"
      confirmLabel="删除大型任务"
      pending={pending}
      onCancel={() => setDeleteProjectOpen(false)}
      onConfirm={() => void removeProject()}
    >
      <p>“{active.project.title}”会从当前世界中移除。删除前会自动创建本地回滚备份，可在设置中恢复。</p>
    </ConfirmDialog>}
  </section>;
}

function SubtaskRow({ id, title, progressBasisPoints, index, count, pending, showDelete, canDelete, deleteReason, onRename, onMove, onDelete }: {
  id: string;
  title: string;
  progressBasisPoints: number;
  index: number;
  count: number;
  pending: boolean;
  showDelete: boolean;
  canDelete: boolean;
  deleteReason: string;
  onRename: (title: string) => Promise<boolean>;
  onMove: (offset: -1 | 1) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  useEffect(() => { setDraft(title); setEditing(false); }, [id, title]);
  const save = async () => {
    const value = draft.trim();
    if (!value || value === title) { setDraft(title); setEditing(false); return; }
    if (await onRename(value)) setEditing(false);
  };
  return <div className="task-editor-row">
    <div className="task-order">{index + 1}</div>
    <div className="task-copy">
      {editing ? <label><span className="sr-only">小任务名称</span><input autoFocus value={draft} disabled={pending} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter') void save();
        if (event.key === 'Escape') { setDraft(title); setEditing(false); }
      }}/></label> : <strong>{title}</strong>}
      <div><progress max={10000} value={progressBasisPoints}/><span>{Math.round(progressBasisPoints / 100)}%</span></div>
    </div>
    <div className="task-row-actions">
      {editing ? <>
        <IconButton label="保存小任务名称" disabled={pending || !draft.trim()} onClick={() => void save()}><Check/></IconButton>
        <IconButton label="取消修改" disabled={pending} onClick={() => { setDraft(title); setEditing(false); }}><X/></IconButton>
      </> : <IconButton label={`修改“${title}”`} disabled={pending} onClick={() => setEditing(true)}><Pencil/></IconButton>}
      <IconButton label={`上移“${title}”`} disabled={pending || index === 0} onClick={() => void onMove(-1)}><ArrowUp/></IconButton>
      <IconButton label={`下移“${title}”`} disabled={pending || index === count - 1} onClick={() => void onMove(1)}><ArrowDown/></IconButton>
      {showDelete && <IconButton label={`删除“${title}”`} title={deleteReason || undefined} disabled={pending || !canDelete} destructive onClick={onDelete}><Trash2/></IconButton>}
    </div>
  </div>;
}

function DailyGoalControl({ state, run }: { state: AppState; run: (command: ApplicationCommand) => Promise<boolean> }) {
  const date = localDateOf(new Date(), state.calendar.timeZone);
  const goal = state.dailyGoals.find(candidate => candidate.date === date);
  const completed = useMemo(() => state.focusHistory.filter(session => session.status === 'completed' && session.completedLocalDate === date).length, [date, state.focusHistory]);
  const [target, setTarget] = useState(String(goal?.targetPomodoros ?? 4));
  const targetRef = useRef(target);
  useEffect(() => { const value = String(goal?.targetPomodoros ?? 4); targetRef.current = value; setTarget(value); }, [date, goal?.targetPomodoros]);
  const parsedTarget = Number(target);
  const validTarget = Number.isInteger(parsedTarget) && parsedTarget > 0;
  const enabled = goal?.enabled ?? false;
  const [requestedEnabled, setRequestedEnabled] = useState<boolean | null>(null);
  useEffect(() => { setRequestedEnabled(null); }, [date, enabled]);
  const [pending, setPending] = useState(false);
  const perform = async (command: ApplicationCommand) => {
    if (pending) return;
    setPending(true);
    try { await run(command); } catch { /* The application shell already reports the error. */ } finally { setPending(false); }
  };
  return <section className="daily-goal" aria-labelledby="daily-goal-title">
    <div className="daily-goal-summary">
      <div><h2 id="daily-goal-title">今日目标</h2><p>{enabled ? `今日 ${completed} / ${goal!.targetPomodoros}` : `今日已完成 ${completed} 次，目标未开启`}</p></div>
      {goal?.reachedAt && <span className="goal-reached"><Check/>今日已达成</span>}
    </div>
    <div className="daily-goal-controls">
      <label className="switch-control"><input type="checkbox" role="switch" checked={requestedEnabled ?? enabled} disabled={pending} onChange={event => {
        const requestedTarget = Number(targetRef.current);
        const checked = event.target.checked;
        setRequestedEnabled(checked);
        if (checked && Number.isInteger(requestedTarget) && requestedTarget > 0) void perform({ type: 'SetDailyGoal', date, targetPomodoros: requestedTarget });
        else if (!checked) void perform({ type: 'DisableDailyGoal', date });
        else setRequestedEnabled(null);
      }}/><span>{(requestedEnabled ?? enabled) ? '已开启' : '开启目标'}</span></label>
      <label>目标次数<input aria-label="今日目标次数" type="number" min="1" step="1" inputMode="numeric" value={target} disabled={pending} onChange={event => { targetRef.current = event.target.value; setTarget(event.target.value); }}/></label>
      <button type="button" disabled={pending || !validTarget || (enabled && parsedTarget === goal?.targetPomodoros)} onClick={() => void perform({ type: 'SetDailyGoal', date, targetPomodoros: parsedTarget })}><Save/>保存</button>
    </div>
  </section>;
}

function ConfirmDialog({ title, confirmLabel, pending, onCancel, onConfirm, children }: { title: string; confirmLabel: string; pending: boolean; onCancel: () => void; onConfirm: () => void; children: React.ReactNode }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onCancel();
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]') ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0]!; const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [onCancel, pending]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !pending) onCancel(); }}>
    <div ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <h2 id="confirm-title">{title}</h2>{children}
      <div className="dialog-actions"><button ref={cancelRef} disabled={pending} onClick={onCancel}>取消</button><button className="danger-action" disabled={pending} onClick={onConfirm}><Trash2/>{confirmLabel}</button></div>
    </div>
  </div>;
}

function IconButton({ label, title, disabled, destructive = false, onClick, children }: { label: string; title?: string; disabled?: boolean; destructive?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={`icon-action${destructive ? ' destructive-icon' : ''}`} aria-label={label} title={title ?? label} disabled={disabled} onClick={onClick}>{children}</button>;
}
