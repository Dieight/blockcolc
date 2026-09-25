import { useEffect, useRef, useState } from 'react';
import type { FocusInterruptionCategory } from '@tomato-clock/domain';
import { X, Square, Check } from 'lucide-react';

const INTERRUPTION_OPTIONS:readonly {value:FocusInterruptionCategory|null;label:string}[]=[
  {value:'external-interruption',label:'外部打扰'}, {value:'task-blocked',label:'任务受阻'},
  {value:'fatigue',label:'需要休息'}, {value:'priority-changed',label:'优先级变化'},
  {value:'device-or-app',label:'设备或应用问题'}, {value:'other',label:'其他'}, {value:null,label:'不记录'},
];

export function EndFocusDialog({taskTitle,habit=false,marathon=false,isLastMarathonRound=false,onClose,onInterrupt,onCompleteEarly}:{taskTitle:string;habit?:boolean;marathon?:boolean;isLastMarathonRound?:boolean;onClose:()=>void;onInterrupt:(reason:FocusInterruptionCategory|null)=>Promise<void>;onCompleteEarly:()=>Promise<void>}){
  const [mode,setMode]=useState<'choose'|'interrupt'>('choose');const [busy,setBusy]=useState(false);const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{closeRef.current?.focus();const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy)onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[busy,onClose]);
  const early=async()=>{setBusy(true);try{await onCompleteEarly();}finally{setBusy(false);}};
  const interrupt=async(reason:FocusInterruptionCategory|null)=>{setBusy(true);try{await onInterrupt(reason);}finally{setBusy(false);}};
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
  return <div className="dialog-backdrop" role="presentation"><div className="confirm-dialog end-focus-dialog" role="dialog" aria-modal="true" aria-labelledby="end-focus-title"><button ref={closeRef} className="dialog-close" aria-label="关闭结束专注窗口" disabled={busy} onClick={onClose}><X/></button><h2 id="end-focus-title">{mode==='choose'?'如何结束这次专注？':'这次为什么中断？'}</h2><p>{mode==='choose'?taskTitle:'选择一项便于以后复盘，也可以不记录。'}</p>{mode==='choose'?<div className="end-focus-choices"><button disabled={busy} onClick={()=>setMode('interrupt')}><Square/><span><strong>中断本轮</strong><small>保留已有任务进度，不计完整轮次{marathon?'；本轮计划继续':''}</small></span></button><button disabled={busy} onClick={()=>void early()}><Check/><span><strong>{earlyLabel}</strong><small>{earlyDetail}</small></span></button></div>:<><div className="interruption-options">{INTERRUPTION_OPTIONS.map(option=><button key={option.value??'none'} disabled={busy} onClick={()=>void interrupt(option.value)}>{option.label}</button>)}</div><button className="dialog-back" disabled={busy} onClick={()=>setMode('choose')}>返回</button></>}</div></div>;
}
