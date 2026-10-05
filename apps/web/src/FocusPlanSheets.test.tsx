import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {FocusPlanSheet,HabitFocusPlanSheet} from './FocusPlanSheets';

const common={rounds:2,focusMinutes:25,breakMinutes:5,locked:false,mode:'rounds' as const,endAtDraft:'23:00',onModeChange:vi.fn(),onEndAtDraftChange:vi.fn(),onRoundsChange:vi.fn(),onClose:vi.fn(),onConfirm:vi.fn(),onCancelPlan:vi.fn(async()=>true)};
const finite={...common,subtasks:[{id:'step',title:'施工',progressBasisPoints:0}],selectedId:'step',onSelect:vi.fn()};

describe('pixel plan presentation',()=>{
  it('offers one direct cancel action, not a reason form, for confirmed plans that have never started',()=>{
    for(const element of [<FocusPlanSheet {...finite} mode="marathon" locked unstarted/>,<HabitFocusPlanSheet {...common} mode="marathon" locked unstarted/>]){
      const html=renderToStaticMarkup(element);
      expect(html).toContain('取消计划');expect(html).not.toContain('确认取消整个计划');
      expect(html).not.toContain('取消原因');expect(html).not.toContain('补充说明');
    }
  });
  it('shares round choices between finite and habit plans while keeping their original task semantics',()=>{
    for(const element of [<FocusPlanSheet {...finite}/>,<HabitFocusPlanSheet {...common}/>]) {
      const html=renderToStaticMarkup(element);
      expect(html).toContain('data-pixel-icon="clock"');
      expect(html).toContain('data-pixel-icon="flag"');
      expect(html.match(/class="plan-round-pixels"/g)).toHaveLength(4);
      expect(html).toContain('class="primary plan-confirm"');
      expect(html).toContain('data-pixel-icon="play"');
    }
    expect(renderToStaticMarkup(<FocusPlanSheet {...finite}/>)).toContain('本次专注');
    expect(renderToStaticMarkup(<HabitFocusPlanSheet {...common}/>)).not.toContain('本次专注');
  });
  it('shares sliding end-time selection without double-tap confirmation, and keeps locked-plan cancellation',()=>{
    for(const element of [<FocusPlanSheet {...finite} mode="marathon" locked/>,<HabitFocusPlanSheet {...common} mode="marathon" locked/>]) {
      const html=renderToStaticMarkup(element);
      expect(html).toContain('role="slider"');
      expect(html).toContain('aria-disabled="true"');
      expect(html).toContain('上下滑动调整');
      expect(html).not.toContain('双击');
      expect(html).not.toContain('time-stepper');
      expect(html).toContain('确认取消整个计划');
      expect(html).not.toContain('type="time"');
      expect(html).not.toContain('class="primary plan-confirm"');
    }
  });
  it('omits completed subtasks and disables confirmation when none remain',()=>{
    const subtasks = [{id:'done',title:'已做完',progressBasisPoints:10000},...finite.subtasks];
    const html=renderToStaticMarkup(<FocusPlanSheet {...finite} selectedId="done" subtasks={subtasks}/>);
    expect(html).not.toContain('已做完'); expect(html).toContain('施工');
    const empty=renderToStaticMarkup(<FocusPlanSheet {...finite} subtasks={[subtasks[0]!]}/>);
    expect(empty).toContain('没有可选项');
    expect(empty).toContain('class="primary plan-confirm" disabled=""');
  });
  it('retains the explicit confirmation button for editable end-time plans',()=>{
    for(const element of [<FocusPlanSheet {...finite} mode="marathon"/>,<HabitFocusPlanSheet {...common} mode="marathon"/>]) {
      const html=renderToStaticMarkup(element);
      expect(html).toContain('role="slider"'); expect(html).toContain('确认计划'); expect(html).not.toContain('双击');
    }
  });
});
