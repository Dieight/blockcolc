import { t, useI18n } from './i18n';
import { useEffect, useRef, useState } from 'react';
import type { ApplicationCommand, ApplicationResult, ApplicationService } from '@blockcolc/application';
import { projectProgressBasisPoints } from '@blockcolc/domain';
import { GripVertical, LockKeyhole, Trash2 } from 'lucide-react';
import { PixelCheck as Check, PixelChevron as ChevronDown, PixelCube as MapPinned, PixelEdit as Pencil, PixelPlus as Plus, PixelRepeat as Repeat2, PixelClose as X, PixelIcon, PixelDisclosure } from './ui/PixelIcon';
import { DailyGoalControl } from './DailyGoalControl';
import { PixelProgress } from './ui/PixelProgress';
import { ChoiceMenu } from './ChoiceMenu';
import { NativeImeTextEntry, isImeCommitKey } from './NativeImeTextEntry';
import { useBackLayer } from './back-layer';
import { QuickNotes } from './QuickNotes';

type ActiveProject = NonNullable<ReturnType<ApplicationService['activeProjectProjection']>>;
type AppState = ReturnType<ApplicationService['snapshot']>;
type RunCommand = (command: ApplicationCommand) => Promise<ApplicationResult>;
type DropTarget = { id: string; position: 'before' | 'after' };

export function TasksScreen({ active, state, run, onCreateProject, onViewProject, quickNotesEnabled=false }: { active: ActiveProject; state: AppState; run: RunCommand; onCreateProject: () => void; onViewProject: (projectId: string) => void; quickNotesEnabled?: boolean }) {
  useI18n();
  const [pending, setPending] = useState(false);
  const commandInFlight = useRef(false);
  const [projectTitle, setProjectTitle] = useState(active.project.title);
  const projectTitleRef = useRef<HTMLInputElement>(null);
  const [editingProject, setEditingProject] = useState(false);
  const [newSubtask, setNewSubtask] = useState('');
  const newSubtaskRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [managingTasks, setManagingTasks] = useState(false);
  const [futureExpanded, setFutureExpanded] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [portfolioExpanded, setPortfolioExpanded] = useState(false);
  const [draggingSubtaskId, setDraggingSubtaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragState = useRef<{ id: string; pointerId: number; startX: number; startY: number; handle: HTMLButtonElement; active: boolean; target: DropTarget | null; timer: number | null } | null>(null);
  const locked = active.project.subtaskStructureLocked;
  const isHabit = active.project.kind === 'habit';
  const habit = active.project.habit;
  const completedHabitBuildings = state.habitBuildings.filter(building => building.habitProjectId === active.project.id).length;
  const hasActiveFocus = state.activeFocusSession !== null;
  const unfinishedProjects = state.projects.filter(project => project.status === 'active' || project.status === 'paused');
  const switchBlocked = hasActiveFocus || active.unreportedCompletedSessions.length > 0;

  useEffect(() => {
    setProjectTitle(active.project.title);
    setEditingProject(false);
    setManagingTasks(false);
    setFutureExpanded(false);
    setCompletedExpanded(false);
    setPortfolioExpanded(false);
  }, [active.project.id, active.project.title]);

  const perform = async (command: ApplicationCommand) => {
    if (commandInFlight.current) return false;
    commandInFlight.current = true;
    setPending(true);
    try {
      const result = await run(command);
      return result.ok;
    } catch {
      return false;
    } finally {
      commandInFlight.current = false;
      setPending(false);
    }
  };

  const renameProject = async () => {
    const title = (projectTitleRef.current?.value ?? projectTitle).trim();
    if (!title || title === active.project.title) {
      setProjectTitle(active.project.title);
      setEditingProject(false);
      return;
    }
    if (await perform({ type: 'RenameProject', title })) setEditingProject(false);
  };

  const addSubtask = async () => {
    const title = (newSubtaskRef.current?.value ?? newSubtask).trim();
    if (!title || locked) return;
    if (await perform({ type: 'AddSubtask', title })) {
      if (newSubtaskRef.current) newSubtaskRef.current.value = '';
      setNewSubtask('');
    }
  };

  const reorderById = async (movingId: string, targetId: string, position: 'before' | 'after') => {
    const orderedSubtaskIds = active.project.subtasks.map((subtask) => subtask.id);
    const movingIndex = orderedSubtaskIds.indexOf(movingId);
    if (movingIndex < 0 || movingId === targetId) return;
    orderedSubtaskIds.splice(movingIndex, 1);
    const targetIndex = orderedSubtaskIds.indexOf(targetId);
    if (targetIndex < 0) return;
    orderedSubtaskIds.splice(targetIndex + (position === 'after' ? 1 : 0), 0, movingId);
    await perform({ type: 'ReorderSubtasks', orderedSubtaskIds });
  };

  const moveSubtaskByOffset = async (subtaskId: string, offset: -1 | 1) => {
    const orderedSubtaskIds = active.project.subtasks.map((subtask) => subtask.id);
    const source = orderedSubtaskIds.indexOf(subtaskId);
    const target = source + offset;
    if (source < 0 || target < 0 || target >= orderedSubtaskIds.length) return;
    [orderedSubtaskIds[source], orderedSubtaskIds[target]] = [orderedSubtaskIds[target]!, orderedSubtaskIds[source]!];
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

  const clearTaskDrag = () => {
    const current = dragState.current;
    if (!current) return;
    if (current.timer !== null) window.clearTimeout(current.timer);
    if (current.handle.isConnected && current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    dragState.current = null;
    setDraggingSubtaskId(null);
    setDropTarget(null);
  };

  const beginTaskDrag = (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (!managingTasks || pending || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, handle, active: false, target: null as DropTarget | null, timer: null as number | null };
    current.timer = window.setTimeout(() => {
      if (dragState.current !== current) return;
      current.active = true;
      current.timer = null;
      setDraggingSubtaskId(id);
    }, 320);
    dragState.current = current;
  };

  const moveTaskDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = dragState.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.active) {
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 8) clearTaskDrag();
      return;
    }
    event.preventDefault();
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-subtask-id]');
    const targetId = row?.dataset.subtaskId;
    if (!row || !targetId || targetId === current.id) {
      if (current.target !== null) { current.target = null; setDropTarget(null); }
      return;
    }
    const rect = row.getBoundingClientRect();
    const target: DropTarget = { id: targetId, position: event.clientY > rect.top + rect.height / 2 ? 'after' : 'before' };
    if (current.target?.id === target.id && current.target.position === target.position) return;
    current.target = target;
    setDropTarget(target);
  };

  const finishTaskDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = dragState.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const target = current.active ? current.target : null;
    const movingId = current.id;
    clearTaskDrag();
    if (target) void reorderById(movingId, target.id, target.position);
  };

  const cancelTaskDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = dragState.current;
    if (current?.pointerId === event.pointerId) clearTaskDrag();
  };

  const nextSubtask = active.project.subtasks.find(subtask => subtask.progressBasisPoints < 10000);
  const futureSubtasks = nextSubtask === undefined ? [] : active.project.subtasks.filter(subtask => subtask.progressBasisPoints < 10000 && subtask.id !== nextSubtask.id);
  const completedSubtasks = active.project.subtasks.filter(subtask => subtask.progressBasisPoints >= 10000);
  const renderSubtask = (subtask: typeof active.project.subtasks[number], index: number) => {
    const hasHistory = state.activeFocusSession?.subtaskId === subtask.id
      || state.focusHistory.some(session => session.subtaskId === subtask.id)
      || state.progressReports.some(report => report.subtaskId === subtask.id);
    const canDelete = !locked && active.project.subtasks.length > 1 && !hasHistory;
    return <SubtaskRow
      key={subtask.id}
      id={subtask.id}
      title={subtask.title}
      progressBasisPoints={subtask.progressBasisPoints}
      phase={subtask.progressBasisPoints >= 10000 ? 'complete' : subtask.id === nextSubtask?.id ? 'current' : 'upcoming'}
      index={index}
      pending={pending}
      managing={managingTasks}
      dragging={draggingSubtaskId === subtask.id}
      dropPosition={dropTarget?.id === subtask.id ? dropTarget.position : null}
      showDelete={!locked}
      canDelete={canDelete}
      deleteReason={locked ? t("已有进度后不能删除") : active.project.subtasks.length === 1 ? t("至少保留一个小任务") : hasHistory ? t("已有专注记录的小任务不能删除") : ''}
      onRename={title => perform({ type: 'RenameSubtask', subtaskId: subtask.id, title })}
      onMove={offset => moveSubtaskByOffset(subtask.id, offset)}
      onDragStart={event => beginTaskDrag(event, subtask.id)}
      onDragMove={moveTaskDrag}
      onDragEnd={finishTaskDrag}
      onDragCancel={cancelTaskDrag}
      onDelete={() => setDeleteTarget({ id: subtask.id, title: subtask.title })}
    />;
  };

  return <section className="page tasks-page">
    <header className="tasks-page-heading"><h1>{t("任务")}</h1><p>{t("把要做的事，排成下一步建造")}</p></header>
    <DailyGoalControl state={state} run={perform} onViewReward={onViewProject}/>
    {quickNotesEnabled && <QuickNotes state={state} run={run}/>}

    <section className="task-planning-panel task-surface" aria-label={t("任务选择与创建")}>
    <h2 className="task-queue-label">{t("我的任务")}</h2>
    <div className="project-switcher">
      <ChoiceMenu label={t("当前任务")} value={active.project.id} disabled={pending || switchBlocked} onChange={projectId=>void perform({ type: 'SwitchActiveProject', projectId })} options={unfinishedProjects.map(project=>({id:project.id,label:project.title,detail:project.kind==='habit'?(project.habit?.awaitingNextBuilding?t("习惯 · 等待选择建筑"):t("习惯 · {0} / {1} 轮", project.habit?.completedFocusSessionIds.length??0, project.habit?.targetRounds??10)):`${Math.round(project.subtasks.reduce((sum, subtask) => sum + subtask.progressBasisPoints, 0) / project.subtasks.length / 100)}%`}))}/>
      <div className="project-switcher-actions"><button type="button" className="project-view-action" disabled={pending} onClick={() => onViewProject(active.project.id)}><MapPinned/>{isHabit&&habit?.awaitingNextBuilding?t("查看聚落"):t("查看建筑")}</button><button type="button" disabled={pending || switchBlocked} title={switchBlocked ? t("请先结束或汇报当前专注") : t("新增任务")} onClick={onCreateProject}><Plus/>{t("新增任务")}</button></div>
    </div>
    </section>

    <section className="task-detail-panel task-surface" aria-label={t("当前任务详情")}>
    <div className="task-project-title">
      {editingProject ? <>
        <label className="sr-only" htmlFor="project-title">{t("任务名称")}</label>
        <NativeImeTextEntry targetRef={projectTitleRef} id="project-title" name="project-title" defaultValue={active.project.title} autoFocus disabled={pending} onValueChange={setProjectTitle} onNativeKeyDown={event => {
          if (isImeCommitKey(event)) void renameProject();
          if (event.key === 'Escape') { setProjectTitle(active.project.title); setEditingProject(false); }
        }}/>
        <IconButton label={t("保存任务名称")} disabled={pending || !projectTitle.trim()} onClick={() => void renameProject()}><Check/></IconButton>
        <IconButton label={t("取消修改")} disabled={pending} onClick={() => { setProjectTitle(active.project.title); setEditingProject(false); }}><X/></IconButton>
      </> : <>
        <h2>{active.project.title}</h2>
        <IconButton label={t("修改任务名称")} disabled={pending} onClick={() => setEditingProject(true)}><Pencil/></IconButton>
      </>}
    </div>

    {isHabit ? <section className="habit-cycle-panel" aria-labelledby="habit-cycle-title">
      <div className="habit-cycle-heading"><Repeat2/><div><h2 id="habit-cycle-title">{t("习惯周期")}</h2><p>{t("每次完整或提前完成的专注都会推进当前建筑。")}</p></div></div>
      <div className="habit-cycle-progress"><div><span>{habit?.awaitingNextBuilding?t("等待下一座建筑"):t("第 {0} 座建筑", habit?.cycleNumber??1)}</span><strong>{habit?.awaitingNextBuilding?t("待选择"):t("{0} / {1} 轮", habit?.completedFocusSessionIds.length??0, habit?.targetRounds??10)}</strong></div><PixelProgress rounds label={t("习惯周期进度")} max={habit?.targetRounds??10} value={habit?.awaitingNextBuilding?habit?.targetRounds??10:habit?.completedFocusSessionIds.length??0}/></div>
      <dl><div><dt>{t("已完成建筑")}</dt><dd>{completedHabitBuildings} {t("座")}</dd></div><div><dt>{t("当前蓝图")}</dt><dd>{habit?.awaitingNextBuilding?t("前往计时页选择"):t("本周期内锁定")}</dd></div></dl>
    </section> : <>
      <div className="task-section-heading">
        <div><h2>{t("施工清单")}</h2><p>{t("已完成")}{' '}{completedSubtasks.length} / {active.project.subtasks.length} {t("项")}</p></div>
        <div className="task-section-actions"><IconButton label={managingTasks ? t("结束编辑施工清单") : t("编辑施工清单")} disabled={pending} onClick={() => setManagingTasks(value => !value)}>{managingTasks ? <Check/> : <Pencil/>}</IconButton></div>
      </div>
      {locked && <div className="structure-lock task-structure-note"><LockKeyhole/><span>{t("已有进度后不能增删，可继续改名和排序。")}</span></div>}

      <div className="task-editor-list">
        {managingTasks ? active.project.subtasks.map(renderSubtask) : <>
          {nextSubtask && <div className="subtask-group current-subtask-group"><span className="subtask-group-label">{t("当前")}</span>{renderSubtask(nextSubtask, active.project.subtasks.indexOf(nextSubtask))}</div>}
          {futureSubtasks.length > 0 && <SubtaskGroup label={t("后续任务")} count={futureSubtasks.length} expanded={futureExpanded} onToggle={() => setFutureExpanded(value => !value)}>{futureSubtasks.map(subtask => renderSubtask(subtask, active.project.subtasks.indexOf(subtask)))}</SubtaskGroup>}
          {completedSubtasks.length > 0 && <SubtaskGroup label={t("已完成")} count={completedSubtasks.length} expanded={completedExpanded} onToggle={() => setCompletedExpanded(value => !value)}>{completedSubtasks.map(subtask => renderSubtask(subtask, active.project.subtasks.indexOf(subtask)))}</SubtaskGroup>}
        </>}
      </div>

      {!locked && managingTasks && <div className="add-subtask">
        <label htmlFor="new-subtask">{t("新增小任务")}</label>
        <div><NativeImeTextEntry targetRef={newSubtaskRef} id="new-subtask" name="new-subtask" defaultValue="" disabled={pending} placeholder={t("例如：整理验证结果")} onValueChange={setNewSubtask} onNativeKeyDown={event => { if (isImeCommitKey(event)) void addSubtask(); }}/><button type="button" disabled={pending || !newSubtask.trim()} onClick={() => void addSubtask()}><Plus/>{t("添加")}</button></div>
      </div>}
    </>}
    </section>

    <ProjectPortfolio state={state} activeProjectId={active.project.id} expanded={portfolioExpanded} switchBlocked={switchBlocked} pending={pending} onToggle={()=>setPortfolioExpanded(value=>!value)} onActivate={projectId=>perform({type:'SwitchActiveProject',projectId})} onView={onViewProject}>
    <section className="project-delete-zone" aria-labelledby="delete-project-title">
      <div><h2 id="delete-project-title">{t("删除任务")}</h2><p>{hasActiveFocus ? t("请先结束当前专注，才能删除任务。") : isHabit ? t("当前未完成建筑会移除，已完成的 {0} 座建筑会保留。删除前仍会创建回滚备份。", completedHabitBuildings) : t("删除前会自动创建本地回滚备份，可在设置中恢复。")}</p></div>
      <button type="button" className="danger-outline" title={hasActiveFocus ? t("请先结束当前专注后再删除任务") : undefined} disabled={pending || hasActiveFocus} onClick={() => setDeleteProjectOpen(true)}><PixelIcon name="close"/>{t("删除当前任务")}</button>
    </section>
    </ProjectPortfolio>

    {deleteTarget && <ConfirmDialog
      title={t("删除这个小任务？")}
      confirmLabel={t("删除小任务")}
      pending={pending}
      onCancel={() => setDeleteTarget(null)}
      onConfirm={() => void removeSubtask()}
    >
      <p>“{deleteTarget.title}{t("”将被永久删除，剩余小任务会重新等分建筑进度。此操作无法撤销。")}</p>
    </ConfirmDialog>}
    {deleteProjectOpen && <ConfirmDialog
      title={t("删除这项任务？")}
      confirmLabel={t("删除任务")}
      pending={pending}
      onCancel={() => setDeleteProjectOpen(false)}
      onConfirm={() => void removeProject()}
    >
      <p>{isHabit?t("“{0}”的当前未完成建筑会被移除，已完成的 {1} 座建筑仍留在聚落中。", active.project.title, completedHabitBuildings):t("“{0}”会从当前世界中移除。", active.project.title)}{t("删除前会自动创建本地回滚备份，可在设置中恢复。")}</p>
    </ConfirmDialog>}
  </section>;
}

function ProjectPortfolio({state,activeProjectId,expanded,switchBlocked,pending,onToggle,onActivate,onView,children}:{state:AppState;activeProjectId:string;expanded:boolean;switchBlocked:boolean;pending:boolean;onToggle:()=>void;onActivate:(projectId:string)=>Promise<boolean>;onView:(projectId:string)=>void;children:React.ReactNode}) {
  useI18n();
  const visible=state.projects.filter(project=>project.status!=='deleted');
  const groups=[
    {id:'current',label:t("当前"),projects:visible.filter(project=>project.id===activeProjectId)},
    {id:'habit',label:t("习惯"),projects:visible.filter(project=>project.kind==='habit'&&project.id!==activeProjectId)},
    {id:'paused',label:t("暂停"),projects:visible.filter(project=>project.kind==='finite'&&project.status==='paused')},
    {id:'completed',label:t("纪念"),projects:visible.filter(project=>project.status==='monument')},
  ].filter(group=>group.projects.length>0);
  return <section className={`project-portfolio task-surface${expanded?' is-expanded':''}`} aria-label={t("任务总览与管理")}>
    <button type="button" className="project-portfolio-toggle" aria-expanded={expanded} onClick={onToggle}>
      <PixelIcon name="tasks"/><span><strong>{t("任务总览与管理")}</strong><small>{groups.map(group=>`${group.label} ${group.projects.length}`).join(' · ')}</small></span><PixelDisclosure expanded={expanded}/>
    </button>
    {expanded && <div className="project-portfolio-body">
      <div className="project-portfolio-groups">{groups.map(group=><section key={group.id}>
        <h3>{group.label}<span>{group.projects.length}</span></h3>
        <div>{group.projects.map(project=>{
          const isCurrent=project.id===activeProjectId;
          const isMonument=project.status==='monument';
          const progress=project.kind==='habit'?(project.habit?.awaitingNextBuilding?t("等待下一座建筑"):t("第 {0} 座 · {1}/{2} 轮", project.habit?.cycleNumber??1, project.habit?.completedFocusSessionIds.length??0, project.habit?.targetRounds??10)):`${Math.round(projectProgressBasisPoints(project)/100)}%`;
          return <div className="project-portfolio-row" key={project.id}>
            <PixelIcon name={isMonument?'cube':project.kind==='habit'?'repeat':isCurrent?'flag':'tasks'}/>
            <span className="project-portfolio-copy"><strong>{project.title}</strong><small>{project.kind==='habit'?t("习惯 · "):''}{progress}</small><PixelProgress value={projectProgressBasisPoints(project)} max={10000} label={t("{0} 建造进度", project.title)}/></span>
            <button type="button" disabled={pending||(!isCurrent&&!isMonument&&switchBlocked)} onClick={()=>{if(isCurrent||isMonument)onView(project.id);else void onActivate(project.id);}}><PixelIcon name={isCurrent||isMonument?'map':'play'}/>{isCurrent||isMonument?t("查看"):t("切换")}</button>
          </div>;
        })}</div>
      </section>)}</div>
      {children}
    </div>}
  </section>;
}

function SubtaskRow({ id, title, progressBasisPoints, phase, index, pending, managing, dragging, dropPosition, showDelete, canDelete, deleteReason, onRename, onMove, onDragStart, onDragMove, onDragEnd, onDragCancel, onDelete }: {
  id: string;
  title: string;
  progressBasisPoints: number;
  phase: 'complete' | 'current' | 'upcoming';
  index: number;
  pending: boolean;
  managing: boolean;
  dragging: boolean;
  dropPosition: 'before' | 'after' | null;
  showDelete: boolean;
  canDelete: boolean;
  deleteReason: string;
  onRename: (title: string) => Promise<boolean>;
  onMove: (offset: -1 | 1) => Promise<void>;
  onDragStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onDragMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onDragEnd: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onDragCancel: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onDelete: () => void;
}) {
  useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const draftRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(title); setEditing(false); }, [id, title]);
  const save = async () => {
    const value = (draftRef.current?.value ?? draft).trim();
    if (!value || value === title) { setDraft(title); setEditing(false); return; }
    if (await onRename(value)) setEditing(false);
  };
  const beginEditing = () => { if (!pending && !dragging) setEditing(true); };
  return <div data-subtask-id={id} className={`task-editor-row task-${phase}${managing ? ' is-managing' : ''}${dragging ? ' is-dragging' : ''}${dropPosition ? ` drop-${dropPosition}` : ''}`} tabIndex={editing ? -1 : 0} aria-label={t("{0}，已完成 {1}%。双击或按 Enter 修改名称。", title, Math.round(progressBasisPoints / 100))} onDoubleClick={beginEditing} onKeyDown={event => {
    if (event.target !== event.currentTarget || editing) return;
    if (event.key === 'Enter') { event.preventDefault(); beginEditing(); }
  }}>
    {managing ? <button type="button" className="task-drag-handle" aria-label={t("长按拖动“{0}”排序；使用方向键微调", title)} disabled={pending} onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragCancel} onKeyDown={event => {
      if (event.key === 'ArrowUp') { event.preventDefault(); void onMove(-1); }
      if (event.key === 'ArrowDown') { event.preventDefault(); void onMove(1); }
    }}><GripVertical/></button> : <div className="task-order"><PixelIcon name={phase === 'complete' ? 'check' : phase === 'current' ? 'flag' : 'tasks'} size={20}/></div>}
    <div className="task-copy">
      {editing ? <label><span className="sr-only" id={`subtask-title-${id}`}>{t("小任务名称")}</span><NativeImeTextEntry targetRef={draftRef} name={`subtask-title-${id}`} defaultValue={title} ariaLabel={t("小任务名称")} autoFocus disabled={pending} onValueChange={setDraft} onNativeKeyDown={event => {
        if (isImeCommitKey(event)) void save();
        if (event.key === 'Escape') { setDraft(title); setEditing(false); }
      }}/></label> : <strong>{title}</strong>}
      <div><PixelProgress max={10000} value={progressBasisPoints} label={t("{0} 施工进度", title)}/><span>{Math.round(progressBasisPoints / 100)}%</span></div>
    </div>
    {editing && <div className="task-row-actions">
      {editing ? <>
        <IconButton label={t("保存小任务名称")} disabled={pending || !draft.trim()} onClick={() => void save()}><Check/></IconButton>
        <IconButton label={t("取消修改")} disabled={pending} onClick={() => { setDraft(title); setEditing(false); }}><X/></IconButton>
        {showDelete && <IconButton label={t("删除“{0}”", title)} title={deleteReason || undefined} disabled={pending || !canDelete} destructive onClick={onDelete}><Trash2/></IconButton>}
      </> : null}
    </div>}
  </div>;
}

function SubtaskGroup({ label, count, expanded, onToggle, children }: { label: string; count: number; expanded: boolean; onToggle: () => void; children: React.ReactNode }) {
  useI18n();
  return <section className={`subtask-group${expanded ? ' is-expanded' : ''}`}><button type="button" className="subtask-group-toggle" aria-label={t("{0} {1} 项", label, count)} aria-expanded={expanded} onClick={onToggle}><span>{label}<small>{count} {t("项")}</small></span><ChevronDown/></button>{expanded && <div className="subtask-group-rows">{children}</div>}</section>;
}


function ConfirmDialog({ title, confirmLabel, pending, onCancel, onConfirm, children }: { title: string; confirmLabel: string; pending: boolean; onCancel: () => void; onConfirm: () => void; children: React.ReactNode }) {
  useI18n();
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
    <div ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-busy={pending}>
      <h2 id="confirm-title">{title}</h2>{children}
      <div className="dialog-actions"><button ref={cancelRef} disabled={pending} onClick={onCancel}>{t("取消")}</button><button className="danger-action" disabled={pending} aria-busy={pending} onClick={onConfirm}><Trash2/>{pending?t("处理中…"):confirmLabel}</button></div>
    </div>
  </div>;
}

function IconButton({ label, title, disabled, destructive = false, onClick, children }: { label: string; title?: string; disabled?: boolean; destructive?: boolean; onClick: () => void; children: React.ReactNode }) {
  useI18n();
  return <button type="button" className={`icon-action${destructive ? ' destructive-icon' : ''}`} aria-label={label} title={title ?? label} disabled={disabled} onClick={onClick}>{children}</button>;
}
