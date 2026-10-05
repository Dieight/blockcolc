import { useEffect, useRef, useState } from 'react';
import type { ApplicationCommand } from '@blockcolc/application';

const WEEKDAYS = [
  { value: 1, label: '一' }, { value: 2, label: '二' }, { value: 3, label: '三' },
  { value: 4, label: '四' }, { value: 5, label: '五' }, { value: 6, label: '六' }, { value: 0, label: '日' },
] as const;

export function PlannedFocusDaysSetting({ calendar, run }: {
  calendar: { timeZone: string; restWeekdays: number[] };
  run: (command: ApplicationCommand) => Promise<unknown>;
}) {
  const [selection,setSelection]=useState(calendar.restWeekdays);
  const desired=useRef(calendar.restWeekdays),saved=useRef(calendar.restWeekdays),generation=useRef(0);
  const plannedCount = 7 - selection.length;
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  useEffect(()=>{saved.current=calendar.restWeekdays;if(!saving.current){desired.current=calendar.restWeekdays;setSelection(calendar.restWeekdays);}},[calendar.restWeekdays]);
  const toggle = (day: number) => {
    const current=desired.current,isRest=current.includes(day);
    if(!isRest&&current.length===6)return;
    desired.current=isRest?current.filter(value=>value!==day):[...current,day].sort((a,b)=>a-b);
    generation.current++;setSelection(desired.current);setError('');
    if(saving.current)return;
    saving.current=true;setBusy(true);
    void (async()=>{
      let adopted=-1;
      // Paint the selection before potentially expensive application projections.
      if(!document.hidden)await new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
      try {
        while(adopted!==generation.current){
          adopted=generation.current;const next=[...desired.current];
          let ok=false;
          try {const result=await run({type:'ConfigureCalendar',timeZone:calendar.timeZone,restWeekdays:next});ok=!(typeof result==='object'&&result!==null&&'ok' in result&&result.ok===false);}catch{}
          if(ok)saved.current=next;
          else if(adopted===generation.current){desired.current=saved.current;setSelection(saved.current);setError('专注日未保存，请重试。');}
        }
      } finally {saving.current=false;setBusy(false);}
    })();
  };
  return <div className="setting-row planned-days-setting" aria-busy={busy}>
    <div className="setting-name"><span>计划专注日</span><small>每周 {plannedCount} 天 · 其余为休息日</small></div>
    <div className="planned-days" role="group" aria-label="计划专注日">
      {WEEKDAYS.map(day => {
        const active = !selection.includes(day.value);
        return <button type="button" key={day.value} aria-pressed={active}
          disabled={active && plannedCount === 1} onClick={() => toggle(day.value)}>
          <span>{day.label}</span><i aria-hidden="true"/>
        </button>;
      })}
    </div>
    {error && <small className="planned-days-error" role="alert">{error}</small>}
  </div>;
}
