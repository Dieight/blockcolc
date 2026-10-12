import {describe,it,expect} from 'vitest';
import {copyDomainState,freezeDomainBlueprints,createInitialState,execute,type ImportedBlueprintV1} from '../src/index.js';

function fixture(){
  const blueprint:ImportedBlueprintV1={schemaVersion:1,id:'imported-copy',title:'Copy',bounds:{minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0},voxels:[{x:0,y:0,z:0,buildOrder:10000,stage:'foundation',materialId:'stone',sourceBlockId:'minecraft:stone',sourceBlockState:{axis:'y'}}]};
  const created=execute(createInitialState('UTC'),{type:'CreateProject',projectId:'p',title:'P',blueprintId:blueprint.id,importedBlueprint:blueprint,subtasks:[{id:'s',title:'S'}]}, {now:()=>new Date('2026-10-09T00:00:00Z')});
  if(!created.ok)throw Error(created.message);return created.state;
}
describe('immutable assets and independent business facts',()=>{
  it('keeps complete-copy isolation for ordinary callers',()=>{
    const state=fixture(),copy=copyDomainState(state);expect(copy.projects[0]!.importedBlueprint).not.toBe(state.projects[0]!.importedBlueprint);
    copy.projects[0]!.importedBlueprint!.voxels[0]!.sourceBlockState!.axis='x';expect(state.projects[0]!.importedBlueprint!.voxels[0]!.sourceBlockState!.axis).toBe('y');
  });
  it('shares deeply frozen assets but independently owns progress and other facts',()=>{
    const state=fixture();freezeDomainBlueprints(state);const copy=copyDomainState(state);
    expect(copy.projects[0]!.importedBlueprint).toBe(state.projects[0]!.importedBlueprint);
    expect(()=>{copy.projects[0]!.importedBlueprint!.voxels[0]!.sourceBlockState!.axis='x';}).toThrow();
    copy.projects[0]!.title='Changed';copy.projects[0]!.subtasks[0]!.progressBasisPoints=9000;
    copy.dailyGoals.push({date:'2026-10-09',targetPomodoros:7,reachedAt:null,enabled:true});
    expect(state.projects[0]!.title).toBe('P');expect(state.projects[0]!.subtasks[0]!.progressBasisPoints).toBe(0);expect(state.dailyGoals).toHaveLength(0);
  });
  it('uses identity only for true lifecycle no-ops and does not miss a due completion',()=>{
    const state=fixture(),clock={now:()=>new Date('2026-10-09T00:00:00Z')};
    const noop=execute(state,{type:'RecordFocusForegrounded'},clock);expect(noop.ok).toBe(true);expect(noop.state).toBe(state);
    expect(execute(state,{type:'RecordFocusForegrounded'},{now:()=>new Date(NaN)}).ok).toBe(false);
    const started=execute(state,{type:'StartFocus',sessionId:'f',subtaskId:'s',plannedDurationMs:60_000},clock);if(!started.ok)throw Error(started.message);
    const expired=execute(started.state,{type:'RecordFocusForegrounded'},{now:()=>new Date('2026-10-09T00:01:00Z')});
    expect(expired).toMatchObject({ok:true,events:[{type:'FocusCompleted'}]});expect(expired.state).not.toBe(started.state);
  });
});
