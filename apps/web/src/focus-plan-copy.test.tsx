import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {FocusPlanSheet} from './FocusPlanSheets';

it('describes direct habit marathons and deferred allocation truthfully',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,18,10,0));
  try{
    const props={habit:true,subtasks:[],selectedId:'',rounds:2,focusMinutes:45,breakMinutes:0,locked:false,
      mode:'marathon' as const,endAtDraft:'12:00',onModeChange:()=>{},onEndAtDraftChange:()=>{},onSelect:()=>{},
      onRoundsChange:()=>{},onClose:()=>{},onConfirm:()=>{},onCancelPlan:async()=>true};
    const direct=renderToStaticMarkup(<FocusPlanSheet {...props}/>);
    expect(direct).toContain('3 轮专注');expect(direct).toContain('按选定时刻结束，末轮可缩短');
    expect(direct).toContain('完成即推进建筑');
    expect(direct).not.toContain('结束后统一汇报');
    const deferred=renderToStaticMarkup(<FocusPlanSheet {...props} deferredSettlement/>);
    expect(deferred).toContain('结束后统一汇报');expect(deferred).not.toContain('完成即推进建筑');
  }finally{vi.useRealTimers();}
});
