import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sampleSummary,summarizeP2Operation} from './p2-cost-summary.mjs';

// Inclusive spans explain call structure; exclusive spans partition the work.
// Only coordinator spans are attributed to the pre-publication business path.
export function coreProfile(operation){
 const t=operation.timing,m=t.marks;
 const spans=t.spans.filter(s=>s.name.startsWith('core/')&&BigInt(s.beginNs)>=BigInt(m.actorStartedNs)&&BigInt(s.endNs)<=BigInt(m.coordinatorReturnedNs))
  .map(s=>({...s,start:BigInt(s.beginNs),end:BigInt(s.endNs),children:0n}))
  .sort((a,b)=>a.start<b.start?-1:a.start>b.start?1:a.end>b.end?-1:1);
 const stack=[],stages={};
 for(const s of spans){
  assert.equal(s.ok,true);assert.ok(s.end>=s.start);
  while(stack.length&&stack.at(-1).end<=s.start)stack.pop();
  if(stack.length){assert.ok(s.end<=stack.at(-1).end,'crossing core intervals');stack.at(-1).children+=s.end-s.start;}
  stack.push(s);
 }
 for(const s of spans){
  const name=s.name.slice(5),x=stages[name]??={calls:0,inclusiveMs:0,exclusiveMs:0};x.calls++;
  assert.ok(s.children<=s.end-s.start);x.inclusiveMs+=Number(s.end-s.start)/1e6;x.exclusiveMs+=Number(s.end-s.start-s.children)/1e6;
 }
 return stages;
}

export function summarizeSubmission(report){
 assert.equal(report.completed,true);assert.equal(report.databaseRestored,true);assert.equal(report.cases.length,5);
 assert.deepEqual(report.cases.map(c=>c.group),[0,1,2,3,4]);assert.match(report.fixtureSha256,/^[a-f0-9]{64}$/);
 assert.ok(Number.isInteger(report.fixtureCharacters)&&report.fixtureCharacters>0);
 const perGroup=report.cases.map(c=>{
  assert.equal(c.completed,true);assert.equal(c.operations.length,7);
  assert.equal(c.initial.length,report.fixtureCharacters);assert.equal(createHash('sha256').update(c.initial).digest('hex'),report.fixtureSha256,'same complete fixture for each group');
  assert.deepEqual(c.operations.map(o=>o.action),['start','early','start','early','start','early','report']);
  assert.deepEqual(c.operations.map(o=>o.sequence),[0,1,2,3,4,5,6]);
  return {group:c.group,operations:c.operations.map(o=>({...summarizeP2Operation(o,'native'),core:coreProfile(o),
   coordinatorWriteCalls:o.timing.transactions.filter(tx=>BigInt(tx.endNs)<=BigInt(o.timing.marks.coordinatorReturnedNs)).reduce((n,t)=>n+t.writeCalls,0),
   coordinatorQueryCalls:o.timing.transactions.filter(tx=>BigInt(tx.endNs)<=BigInt(o.timing.marks.coordinatorReturnedNs)).reduce((n,t)=>n+t.queryCalls,0)}))};
 });
 const selected={all:()=>true,withoutFirstStart:o=>o.sequence!==0&&o.action!=='report',firstStart:o=>o.sequence===0,report:o=>o.action==='report'};
 const groups={};
 for(const [name,select] of Object.entries(selected)){
  const rows=perGroup.map(g=>g.operations.filter(select));
  const metrics=Object.fromEntries(['inputToFactCommitAckMs','businessMs','postCommitBusinessMs','factTransactionsMs','coordinatorTransactionsMs','coordinatorQueryExecuteMs','postBusinessHostMs','coordinatorWriteCalls','coordinatorQueryCalls']
    .map(k=>[k,sampleSummary(rows.map(r=>sampleSummary(r.map(o=>o[k])).median))]));
  const names=[...new Set(rows.flat().flatMap(o=>Object.keys(o.core)))].sort();
  const stages=Object.fromEntries(names.map(k=>[k,Object.fromEntries(['calls','inclusiveMs','exclusiveMs'].map(v=>[v,sampleSummary(rows.map(r=>sampleSummary(r.map(o=>o.core[k]?.[v]??0)).median))]))]));
  groups[name]={metrics,stages};
 }
 return {schema:1,scope:report.scope,fixtureSha256:report.fixtureSha256,fixtureCharacters:report.fixtureCharacters,groups,perGroup,
  limitations:['Five group medians, not 35 independent trials or P99. The first group and all individual actions remain visible.',
   'No rendered world or Compose in this focused run. Do not substitute this number for active-world input latency or whole-App startup.',
   'Engine acknowledgement only, not proof of equal physical durability with IndexedDB. Core stage spans are opt-in observations; exclusive stage times avoid nested double counting.']};
}
