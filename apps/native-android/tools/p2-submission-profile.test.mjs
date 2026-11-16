import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {coreProfile,summarizeSubmission} from './p2-submission-profile.mjs';

const op=spans=>({timing:{marks:{actorStartedNs:'0',coordinatorReturnedNs:'100000000'},spans:spans.map(([name,start,end,ok=true])=>({name:'core/'+name,beginNs:String(start*1e6),endNs:String(end*1e6),ok}))}});
test('nested costs partition parent work and exclude host adoption',()=>{
 const result=coreProfile(op([['parse',10,20],['execute',0,40],['validate',25,35],['parse',50,60],['parse',110,120]]));
 assert.deepEqual(result,{execute:{calls:1,inclusiveMs:40,exclusiveMs:20},parse:{calls:2,inclusiveMs:20,exclusiveMs:20},validate:{calls:1,inclusiveMs:10,exclusiveMs:10}});
});
test('crossing or failed stages cannot become accepted evidence',()=>{
 assert.throws(()=>coreProfile(op([['a',0,20],['b',10,30]])),/crossing/);
 assert.throws(()=>coreProfile(op([['a',0,20,false]])));
});
test('submission summaries require all five complete groups, exact fixtures, sequence and actual commits',()=>{
 const initial='{}',actions=['start','early','start','early','start','early','report'];
 const operation=(action,sequence)=>({action,sequence,inputNs:'1',savedNs:'90',timing:{schema:2,backend:'native',marks:{actorStartedNs:'2',coordinatorReturnedNs:'40',adoptedNs:'70',actorFinishedNs:'80'},spans:[],
  transactions:[{beginNs:'10',bodyEndNs:'20',endNs:'30',queryNs:'2',executeNs:'3',writeCalls:1,queryCalls:1,facts:true,ok:true}]}});
 const report={completed:true,databaseRestored:true,fixtureSha256:createHash('sha256').update(initial).digest('hex'),fixtureCharacters:2,
  cases:Array.from({length:5},(_,group)=>({group,completed:true,initial,operations:actions.map(operation)}))};
 assert.equal(summarizeSubmission(report).groups.withoutFirstStart.metrics.inputToFactCommitAckMs.values.length,5);
 for(const mutate of [r=>r.cases.pop(),r=>r.cases[1].initial='[]',r=>r.cases[0].operations[1].sequence=0,
  r=>r.cases[0].operations[0].timing.transactions[0].ok=false,r=>r.databaseRestored=false]){
  const broken=structuredClone(report);mutate(broken);assert.throws(()=>summarizeSubmission(broken));
 }
});
