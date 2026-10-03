import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {FocusPlanSheet,HabitFocusPlanSheet} from './FocusPlanSheets';

const common={rounds:2,focusMinutes:25,breakMinutes:5,locked:false,mode:'rounds' as const,endAtDraft:'23:00',onModeChange:vi.fn(),onEndAtDraftChange:vi.fn(),onRoundsChange:vi.fn(),onClose:vi.fn(),onConfirm:vi.fn(),onCancelPlan:vi.fn(async()=>true)};
const finite={...common,subtasks:[{id:'step',title:'施工',progressBasisPoints:0}],selectedId:'step',onSelect:vi.fn()};

describe('pixel plan presentation',()=>{
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
  it('keeps end-time steppers and locked-plan cancellation, without introducing editable time inputs',()=>{
    for(const element of [<FocusPlanSheet {...finite} mode="marathon" locked/>,<HabitFocusPlanSheet {...common} mode="marathon" locked/>]) {
      const html=renderToStaticMarkup(element);
      expect(html.match(/data-pixel-icon="minus"/g)).toHaveLength(2);
      expect(html.match(/data-pixel-icon="plus"/g)).toHaveLength(2);
      expect(html).toContain('aria-label="减少结束小时" disabled=""');
      expect(html).toContain('确认取消整个计划');
      expect(html).not.toContain('type="time"');
      expect(html).not.toContain('class="primary plan-confirm"');
    }
  });
});
