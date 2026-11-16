import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

/** Reuse actual formal command results rather than inventing native history.
 * Every command-corpus fingerprint is checked before its states are used. */
export async function presentationStateOracle(load,root,canonical,sourceHashes){
 const file='apps/native-android/domain-core/build/generated/command-oracle/command-oracle.json';
 const input=JSON.parse(readFileSync(new URL(file,root),'utf8'));
 for(const [name,expected]of Object.entries(input.sourceHashes)){
  assert.equal(createHash('sha256').update(readFileSync(new URL(name,root))).digest('hex'),expected,`Stale state corpus: ${name}`);
  sourceHashes[name]=expected;
 }
 const {parseDomainState,localDateOf,addLocalDays,dailyGoalForDate}=await load('packages/domain/src/index.ts');
 const {projectAchievements}=await load('packages/application/src/achievements.ts');
 const {focusWindowSummary,dailyGoalTargetForWindow,projectFocusAllocation}=await load('apps/web/src/focus-stats.ts');
 const {projectTodayFocusTimeline}=await load('apps/web/src/today-focus-timeline.ts');
 const cases=[],seen=new Set();
 for(let index=0;index<input.cases.length;index++){
  const entry=input.cases[index],signature=entry.canonical+'|'+entry.now;
  if(seen.has(signature))continue;seen.add(signature);
  const state=parseDomainState(JSON.parse(entry.canonical));
  const today=localDateOf(new Date(entry.now),state.calendar.timeZone);
  const ranges=[1,3,30].map(days=>{
   const summary=focusWindowSummary(state,today,days);
   return {start:addLocalDays(today,1-days),end:today,...summary,goal:dailyGoalTargetForWindow(state,today,days),
    targets:projectFocusAllocation(state,today,days).map(t=>({projectId:t.unallocated?null:t.projectId,durationMs:t.durationMs})).sort((a,b)=>String(a.projectId).localeCompare(String(b.projectId)))};
  });
  const dates=[...new Set([today,...state.focusHistory.map(h=>h.completedLocalDate).filter(Boolean)])].sort();
  cases.push({caseIndex:index,now:entry.now,today,todayGoal:dailyGoalForDate(state,today),ranges,achievements:projectAchievements(state),timelines:dates.map(date=>projectTodayFocusTimeline(state,date))});
 }
 return cases;
}
