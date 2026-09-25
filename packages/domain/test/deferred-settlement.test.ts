import { describe, expect, it } from 'vitest';
import { createInitialState, execute, parseDomainState, type DomainCommand } from '../src/index.js';

function fixture(kind: 'finite' | 'habit' = 'finite') {
  let now = Date.parse('2026-09-06T08:00:00.000Z');
  let state = createInitialState('UTC');
  const run = (command: DomainCommand) => {
    const result = execute(state, command, { now: () => new Date(now) });
    if (!result.ok) throw new Error(result.message);
    state = result.state;
    expect(parseDomainState(state)).toEqual(state);
    return result;
  };
  run(kind === 'habit'
    ? { type:'CreateHabitProject', projectId:'host', title:'Habit', blueprintId:'cottage', targetRounds:10 }
    : { type:'CreateProject', projectId:'host', title:'Project', blueprintId:'cottage', subtasks:[{id:'s',title:'Work'}] });
  const start = (id = 'round') => run({type:'StartFocus', sessionId:id, subtaskId:null, plannedDurationMs:60_000, marathon:true, deferredSettlement:true});
  return { run, start, state:() => state, advance:(ms:number) => {now += ms;}, restore:() => {state=parseDomainState(JSON.parse(JSON.stringify(state)));} };
}

describe('minimal marathon deferred settlement', () => {
  it.each(['finite','habit'] as const)('records %s-host rounds without assigning a subtask or advancing a building', kind => {
    const f=fixture(kind); const before=structuredClone(f.state().projects);
    f.start(); f.restore(); f.advance(60_000); f.run({type:'CompleteFocus'});
    expect(f.state().projects).toEqual(before);
    expect(f.state().focusHistory[0]).toMatchObject({subtaskId:null, marathon:true, deferredSettlement:true, status:'completed'});
    expect(f.state().progressReports).toEqual([]);
    f.restore();
  });
  it.each(['finite','habit'] as const)('early completion of a %s host preserves unified settlement', kind => {
    const f=fixture(kind); const before=structuredClone(f.state().projects);
    f.start(); f.advance(10_000); f.run({type:'CompleteFocusEarly', reportId:'unused'});
    expect(f.state().projects).toEqual(before);
    expect(f.state().focusHistory[0]).toMatchObject({deferredSettlement:true,status:'completed-early',actualDurationMs:10_000});
    expect(f.state().progressReports).toEqual([]);
  });
  it('uses the existing unified report and rejects double allocation', () => {
    const f=fixture(); f.start(); f.advance(60_000); f.run({type:'CompleteFocus'});
    const report:DomainCommand={type:'ReportMarathonFocus',focusSessionIds:['round'],entries:[{projectId:'host',subtaskId:'s',reportId:'report',progressBasisPoints:5000}],habitAllocations:[]};
    f.run(report);
    expect(f.state().projects[0]!.subtasks[0]!.progressBasisPoints).toBe(5000);
    expect(f.state().focusHistory[0]!.settledAt).toBeDefined();
    expect(execute(f.state(),report,{now:()=>new Date('2026-09-06T08:02:00Z')})).toMatchObject({ok:false,code:'FOCUS_ALREADY_REPORTED'});
  });
  it('only advances a habit when the final report explicitly allocates a round', () => {
    const f=fixture('habit'); f.start(); f.advance(60_000); f.run({type:'CompleteFocus'});
    expect(f.state().projects[0]!.habit!.completedFocusSessionIds).toEqual([]);
    f.run({type:'ReportMarathonFocus',focusSessionIds:['round'],entries:[],habitAllocations:[{projectId:'host',rounds:1}]});
    expect(f.state().projects[0]!.habit!.completedFocusSessionIds).toEqual(['round']);
  });
  it('records an interruption but does not offer it to the unified report', () => {
    const f=fixture(); f.start(); f.advance(1_000); f.run({type:'CancelFocus'});
    expect(f.state().focusHistory[0]).toMatchObject({status:'interrupted',deferredSettlement:true});
    expect(execute(f.state(),{type:'ReportMarathonFocus',focusSessionIds:['round'],entries:[],habitAllocations:[]},{now:()=>new Date('2026-09-06T08:02:00Z')})).toMatchObject({ok:false,code:'PROGRESS_REQUIRES_COMPLETED_FOCUS'});
  });
  it('migrates schema 10 without inventing deferred semantics and rejects malformed flags', () => {
    const f=fixture(); const legacy={...structuredClone(f.state()),schemaVersion:10,
      focusIntegrityPolicy: { enabled: true, maxEffectiveExcursions: 3 }};
    expect(parseDomainState(legacy)).toEqual(f.state());
    f.start();
    for (const override of [{deferredSettlement:false},{marathon:false},{subtaskId:'s'}]) {
      const raw=structuredClone(f.state()); Object.assign(raw.activeFocusSession!,override);
      expect(()=>parseDomainState(raw)).toThrow();
    }
    expect(()=>parseDomainState({...f.state(),schemaVersion:10})).toThrow();
  });
  it('does not allow ordinary finite focus to lose its subtask', () => {
    const f=fixture();
    expect(execute(f.state(),{type:'StartFocus',sessionId:'bad',subtaskId:null,plannedDurationMs:1},{now:()=>new Date('2026-09-06T08:00:00Z')})).toMatchObject({ok:false,code:'SUBTASK_NOT_FOUND'});
    expect(execute(f.state(),{type:'StartFocus',sessionId:'bad',subtaskId:'s',plannedDurationMs:1,marathon:true,deferredSettlement:true},{now:()=>new Date('2026-09-06T08:00:00Z')})).toMatchObject({ok:false,code:'INVALID_INPUT'});
  });
});
