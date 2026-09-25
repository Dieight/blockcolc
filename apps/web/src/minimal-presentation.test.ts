import {describe,expect,it} from 'vitest';
import {createInitialState,execute} from '@tomato-clock/domain';
import {canPresentMinimalFocus} from './minimal-presentation';
import type {RoundPlan} from './round-plan';

const created=execute(createInitialState('UTC'),{type:'CreateProject',projectId:'p',title:'Work',blueprintId:'cottage',subtasks:[{id:'s',title:'Task'}]},{now:()=>new Date('2026-09-06T00:00:00Z')});
if(!created.ok)throw Error(created.message);
const state=created.state;
const plan:RoundPlan={projectId:'p',subtaskId:null,mode:'marathon',deferredSettlement:true,status:'ready',completedRounds:0,totalRounds:2,reportedSessionIds:[]};
describe('minimal presentation priority',()=>{
 it('is opt-in and never replaces first setup',()=>{
  expect(canPresentMinimalFocus(state,null,false,false)).toBe(false);
  expect(canPresentMinimalFocus(createInitialState('UTC'),null,true,false)).toBe(false);
  expect(canPresentMinimalFocus(state,null,true,false)).toBe(true);
 });
 it('lets pending reporting and existing ordinary plans win',()=>{
  expect(canPresentMinimalFocus(state,null,true,true)).toBe(false);
  expect(canPresentMinimalFocus(state,{...plan,status:'report'},true,false)).toBe(false);
  expect(canPresentMinimalFocus(state,{...plan,deferredSettlement:undefined,subtaskId:'s'},true,false)).toBe(false);
 });
 it.each(['ready','break','focus'] as const)('keeps deferred %s immersive',status=>{
  expect(canPresentMinimalFocus(state,{...plan,status},true,false)).toBe(true);
 });
 it('does not relabel an ordinary active session as minimal',()=>{
  const result=execute(state,{type:'StartFocus',sessionId:'r',subtaskId:'s',plannedDurationMs:60_000},{now:()=>new Date('2026-09-06T00:00:00Z')});
  if(!result.ok)throw Error(result.message);
  expect(canPresentMinimalFocus(result.state,null,true,false)).toBe(false);
 });
});
