import type { DomainState } from '@blockcolc/domain';
import { t, useI18n } from '../i18n';
import { AnimatedDetails } from './AnimatedDetails';
import { PixelChevron, PixelRepeat, PixelTasks, PixelCheck } from './PixelIcon';

export function orderedFocusProjects(projects:DomainState['projects'],currentId:string){
  return projects.filter(project=>project.status==='active'||project.status==='paused')
    .sort((a,b)=>Number(b.id===currentId)-Number(a.id===currentId)||Number(b.kind==='habit')-Number(a.kind==='habit'));
}

/** A draft selection only; confirming the plan owns the durable project switch. */
export function FocusTaskPicker({projects,currentId,projectId,subtaskId,disabled,onSelect}:{
  projects:DomainState['projects'];currentId:string;projectId:string;subtaskId:string|null;disabled:boolean;
  onSelect:(projectId:string,subtaskId:string|null)=>void;
}){
  useI18n();
  return <section className="focus-task-picker" aria-label={t('本次专注')}><h3>{t('本次专注')}</h3>
    {orderedFocusProjects(projects,currentId).map(project=>{
      const habit=project.kind==='habit',waiting=habit&&project.habit?.awaitingNextBuilding;
      const tasks=project.subtasks.filter(task=>task.progressBasisPoints<10000);
      if(habit)return <button key={project.id} type="button" className="focus-task-project focus-task-habit" disabled={disabled||waiting} aria-pressed={projectId===project.id} onClick={()=>onSelect(project.id,null)}>
        <PixelRepeat size={18}/><span><strong>{project.title}</strong><small>{waiting?t('请先选择下一座建筑'):t('每座 {0} 轮',project.habit?.targetRounds??10)}</small></span>{projectId===project.id&&<PixelCheck size={16}/>}
      </button>;
      return <AnimatedDetails key={project.id} className="focus-task-project" defaultOpen={project.id===currentId}
        summary={<><PixelTasks size={18}/><span><strong>{project.title}</strong><small>{project.id===currentId?t('当前大任务'):t('大型任务')}</small></span><PixelChevron size={16}/></>}>
        <div className="focus-task-options">{tasks.map(task=><button key={task.id} type="button" disabled={disabled} aria-pressed={projectId===project.id&&subtaskId===task.id} onClick={()=>onSelect(project.id,task.id)}>
          <span>{task.title}<small>{t('进度 {0}%',Math.round(task.progressBasisPoints/100))}</small></span>{projectId===project.id&&subtaskId===task.id&&<PixelCheck size={16}/>}
        </button>)}</div>
      </AnimatedDetails>;
    })}
  </section>;
}
