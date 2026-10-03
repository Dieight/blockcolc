import { useEffect, useRef, useState } from 'react';
import type { FocusInterruptionCategory } from '@blockcolc/domain';
import { PixelClose as X, PixelStop as Square, PixelCheck as Check } from './ui/PixelIcon';

const INTERRUPTION_OPTIONS:readonly {value:FocusInterruptionCategory|null;label:string}[]=[
  {value:'external-interruption',label:'外部打扰'}, {value:'task-blocked',label:'任务受阻'},
  {value:'fatigue',label:'需要休息'}, {value:'priority-changed',label:'优先级变化'},
  {value:'device-or-app',label:'设备或应用问题'}, {value:'other',label:'其他'}, {value:null,label:'不记录'},
];

export function EndFocusDialog({taskTitle,habit=false,marathon=false,isLastMarathonRound=false,multiRound=false,cancellationReason=null,cancellationNote='',onClose,onInterrupt,onCompleteEarly,onCancelPlan}:{taskTitle:string;habit?:boolean;marathon?:boolean;isLastMarathonRound?:boolean;multiRound?:boolean;cancellationReason?:FocusInterruptionCategory|null;cancellationNote?:string;onClose:()=>void;onInterrupt:(reason:FocusInterruptionCategory|null)=>Promise<void>;onCompleteEarly:()=>Promise<void>;onCancelPlan?:(reason:FocusInterruptionCategory|null,note:string)=>Promise<boolean>}){
  const [mode,setMode]=useState<'choose'|'interrupt'|'cancel-plan'>('choose');const [busy,setBusy]=useState(false);const [cancelReason,setCancelReason]=useState<FocusInterruptionCategory|null>(cancellationReason);const [cancelNote,setCancelNote]=useState(cancellationNote);const [cancelError,setCancelError]=useState('');const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{closeRef.current?.focus();const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy)onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[busy,onClose]);
  const early=async()=>{setBusy(true);try{await onCompleteEarly();}finally{setBusy(false);}};
  const interrupt=async(reason:FocusInterruptionCategory|null)=>{setBusy(true);try{await onInterrupt(reason);}finally{setBusy(false);}};
  const cancelPlan=async()=>{if(!onCancelPlan||cancelReason===null||!cancelNote.trim())return;setBusy(true);setCancelError('');try{if(!await onCancelPlan(cancelReason,cancelNote.trim()))setCancelError('取消未完成，请重试；当前计划仍保留。');}catch{setCancelError('保存失败，请重试；当前计划仍保留。');}finally{setBusy(false);}};
  const earlyLabel = marathon || habit ? '提前完成本轮' : '提前完成任务';
  const earlyDetail = marathon
    ? habit
      ? isLastMarathonRound ? '推进当前习惯建筑，并结束本场计划' : '推进当前习惯建筑，并继续本场计划'
      : isLastMarathonRound ? '记录本轮，并进入本场统一汇报' : '记录本轮，并继续本场计划'
    : habit
      ? '推进当前习惯建筑，并结束本轮计划'
      : '将当前小任务标为完成并结束本轮计划';
  // End-time rounds can finish early without claiming that a finite subtask is
  // complete. The domain records the round; only the final settlement changes
  // finite-task progress.
  return <div className="dialog-backdrop" role="presentation"><div className="confirm-dialog end-focus-dialog" role="dialog" aria-modal="true" aria-labelledby="end-focus-title"><button ref={closeRef} className="dialog-close" aria-label="关闭结束专注窗口" disabled={busy} onClick={onClose}><X/></button><h2 id="end-focus-title">{mode==='choose'?'如何结束这次专注？':mode==='interrupt'?'这次为什么中断？':'取消整个多轮计划？'}</h2><p>{mode==='choose'?taskTitle:mode==='interrupt'?'选择一项便于以后复盘，也可以不记录。':'已完成轮次会保留并进入汇报；当前未完成轮次会按中断记录。'}</p>{mode==='choose'?<div className="end-focus-choices"><button disabled={busy} onClick={()=>setMode('interrupt')}><Square/><span><strong>中断本轮</strong><small>保留已有任务进度，不计完整轮次{marathon?'；本轮计划继续':''}</small></span></button><button disabled={busy} onClick={()=>void early()}><Check/><span><strong>{earlyLabel}</strong><small>{earlyDetail}</small></span></button>{multiRound&&onCancelPlan&&<button disabled={busy} onClick={()=>{setCancelError('');setMode('cancel-plan');}}><X/><span><strong>取消整个计划</strong><small>结束后续轮次，已完成轮次仍可汇报</small></span></button>}</div>:mode==='interrupt'?<><div className="interruption-options">{INTERRUPTION_OPTIONS.map(option=><button key={option.value??'none'} disabled={busy} onClick={()=>void interrupt(option.value)}>{option.label}</button>)}</div><button className="dialog-back" disabled={busy} onClick={()=>setMode('choose')}>返回</button></>:<><div className="interruption-options">{INTERRUPTION_OPTIONS.filter(option=>option.value!==null).map(option=><button key={option.value} type="button" aria-pressed={cancelReason===option.value} disabled={busy} onClick={()=>setCancelReason(option.value)}>{option.label}</button>)}</div><label className="cancel-plan-note">补充说明<textarea required maxLength={200} rows={3} value={cancelNote} disabled={busy} onChange={event=>setCancelNote(event.target.value)} placeholder="简短写下结束计划的原因"/></label><small className="cancel-plan-count">{cancelNote.length} / 200 字</small>{cancelError&&<p className="plan-sheet-error" role="alert">{cancelError}</p>}<button className="primary destructive" disabled={busy||cancelReason===null||!cancelNote.trim()} onClick={()=>void cancelPlan()}>{busy?'正在保存…':'确认取消整个计划'}</button><button className="dialog-back" disabled={busy} onClick={()=>setMode('choose')}>返回</button></>}</div></div>;
}
