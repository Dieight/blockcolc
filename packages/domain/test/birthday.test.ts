import { describe, expect, it } from 'vitest';
import { birthdayOnDate, createInitialState, execute, parseDomainState, type DomainCommand } from '../src/index.js';

const clock = { now: () => new Date('2026-10-18T04:00:00Z') };
describe('birthday keepsakes', () => {
  it('is off for old and new users, migrating schema 14 without rewriting facts', () => {
    const state = createInitialState('Asia/Shanghai');
    const { birthday: _birthday, birthdayRewards: _rewards, ...old } = state;
    expect(parseDomainState({ ...old, schemaVersion: 14 })).toEqual(state);
    expect(execute(state, { type: 'ObserveBirthday' }, clock).state).toBe(state);
  });
  it('grants on entry without projects or focus, once per calendar year', () => {
    const configured = execute(createInitialState('Asia/Shanghai'), { type: 'ConfigureBirthday', enabled: true, month: 10, day: 18 }, clock);
    expect(configured.ok).toBe(true);
    const granted = execute(configured.state, { type: 'ObserveBirthday' }, clock);
    expect(granted.ok && granted.events).toEqual([{ type:'BirthdayRewardGranted', year:2026, date:'2026-10-18' }]);
    expect(granted.state.birthdayRewards).toHaveLength(1);
    expect(granted.state.focusHistory).toEqual([]);
    expect(parseDomainState(granted.state)).toEqual(granted.state);
    const duplicate = execute(granted.state, { type:'ObserveBirthday' }, clock);
    expect(duplicate.state).toBe(granted.state);
    expect(duplicate.ok && duplicate.events).toEqual([]);
    const disabled = execute(granted.state, { type:'ConfigureBirthday', enabled:false, month:10, day:18 }, clock);
    expect(disabled.state.birthdayRewards).toEqual(granted.state.birthdayRewards);
    const nextYear = execute(granted.state,{type:'ObserveBirthday'},{now:()=>new Date('2027-10-18T04:00:00Z')});
    expect(nextYear.state.birthdayRewards).toHaveLength(2);
  });
  it('uses the saved timezone and rejects invalid dates or duplicate rewards', () => {
    const state = createInitialState('Asia/Shanghai'); state.birthday={enabled:true,month:10,day:18};
    expect(execute(state,{type:'ObserveBirthday'},{now:()=>new Date('2026-10-17T16:01:00Z')}).state.birthdayRewards).toHaveLength(1);
    expect(execute(state,{type:'ConfigureBirthday',enabled:true,month:2,day:30},clock).ok).toBe(false);
    expect(birthdayOnDate({enabled:true,month:2,day:29},'2027-02-28')).toBe(true);
    expect(birthdayOnDate({enabled:true,month:2,day:29},'2028-02-28')).toBe(false);
    const rewarded=execute(state,{type:'ObserveBirthday'},clock).state;
    expect(()=>parseDomainState({...rewarded,birthdayRewards:[...rewarded.birthdayRewards,...rewarded.birthdayRewards]})).toThrow();
    expect(()=>parseDomainState({...rewarded,birthday:{enabled:true,month:'10',day:18}})).toThrow();
  });
  it.each([true,false])('keeps overlapping festival grants independent of the birthday (birthday first: %s)',birthdayFirst=>{
    let now=Date.parse('2026-11-01T04:00:00Z'),state=createInitialState('Asia/Shanghai');
    const run=(command:DomainCommand)=>{const result=execute(state,command,{now:()=>new Date(now)});if(!result.ok)throw Error(result.message);state=result.state;expect(parseDomainState(state)).toEqual(state);return result;};
    run({type:'CreateProject',projectId:'p',title:'工坊',blueprintId:'builtin-small-workshop',subtasks:[{id:'s',title:'施工'}]});
    run({type:'DisableDailyGoal',date:'2026-11-01'});run({type:'ConfigureBirthday',enabled:true,month:11,day:1});
    if(birthdayFirst){run({type:'ObserveBirthday'});expect(state.birthdayRewards).toHaveLength(1);expect(state.holidayRewards).toEqual([]);}
    run({type:'StartFocus',sessionId:'one',subtaskId:'s',plannedDurationMs:60000});now+=60000;run({type:'CompleteFocus'});
    if(!birthdayFirst){expect(state.birthdayRewards).toEqual([]);run({type:'ObserveBirthday'});}
    expect(state.birthdayRewards).toHaveLength(1);expect(state.holidayRewards.map(reward=>reward.holidayId)).toEqual(['halloween','day-of-dead']);
    state=parseDomainState(structuredClone(state));run({type:'ObserveBirthday'});
    run({type:'StartFocus',sessionId:'two',subtaskId:'s',plannedDurationMs:60000});now+=60000;run({type:'CompleteFocus'});
    expect(state.birthdayRewards).toHaveLength(1);expect(state.holidayRewards).toHaveLength(2);
  });
});
