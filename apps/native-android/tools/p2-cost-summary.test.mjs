import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sampleSummary,summarizeP2Costs,summarizeP2Operation} from './p2-cost-summary.mjs';

test('summary keeps every sample, a median and range, not just the fastest',()=>{
  assert.deepEqual(sampleSummary([7,1,5,3,9]),{values:[7,1,5,3,9],median:5,range:[1,9]});
  assert.equal(sampleSummary([4,2]).median,3);
  assert.throws(()=>sampleSummary([]));assert.throws(()=>sampleSummary([NaN]));
});
test('old savedNs, missing commits, failed writes and post-projection endpoints cannot pass as a commit acknowledgement',()=>{
  assert.throws(()=>summarizeP2Operation({savedNs:'1000'},'native'),/not a persistence measurement/);
  const operation={action:'start',sequence:0,inputNs:'1',savedNs:'90',timing:{schema:2,backend:'native',
    marks:{actorStartedNs:'2',coordinatorReturnedNs:'40',adoptedNs:'70',actorFinishedNs:'80'},
    spans:[{name:'test-live-diagnostic',beginNs:'60',endNs:'70',ok:true}],
    transactions:[{beginNs:'10',bodyEndNs:'20',endNs:'30',queryNs:'2',executeNs:'3',facts:true,ok:true}]}};
  const value=summarizeP2Operation(operation,'native');assert.equal(value.inputToFactCommitAckMs,29/1e6);assert.equal(value.postBusinessHostMs,50/1e6);
  assert.equal(value.postCommitBusinessMs,10/1e6);
  const missing=structuredClone(operation);missing.timing.transactions[0].facts=false;assert.throws(()=>summarizeP2Operation(missing,'native'),/actual fact commit/);
  const failed=structuredClone(operation);failed.timing.transactions[0].ok=false;assert.throws(()=>summarizeP2Operation(failed,'native'),/unfinished transactions/);
  const late=structuredClone(operation);late.timing.transactions[0].endNs='50';assert.throws(()=>summarizeP2Operation(late,'native'),/clock order/);
  const web={...operation,timing:{schema:2,backend:'web',marks:{serviceStartedNs:'2',repositorySaveAcknowledgedNs:'31',serviceReturnedNs:'40'},spans:[],
    transactions:[{beginNs:'10',endNs:'30',facts:true,ok:true}]}};
  assert.equal(summarizeP2Operation(web,'web').inputToFactCommitAckMs,29/1e6);
  delete web.timing.marks.repositorySaveAcknowledgedNs;assert.throws(()=>summarizeP2Operation(web,'web'));
});
test('a preflight or interrupted comparison cannot become five-pair evidence',()=>{
  assert.throws(()=>summarizeP2Costs({completed:false}));
  assert.throws(()=>summarizeP2Costs({completed:true,repeats:1,cases:[]}));
  assert.throws(()=>summarizeP2Costs({completed:true,repeats:5,cases:[],fixtures:['ocean','coast']}));
});
test('static geometry alone, a changed buffer or a backwards clock cannot pass the completed-world summary',()=>{
  const report={completed:true,repeats:5,fixtures:['ocean','coast'],restored:{database:true},cases:[]};
  for(const fixture of report.fixtures)for(const backend of ['native','web'])for(let pair=0;pair<5;pair++){
    const count=fixture==='ocean'?8:31;
    const frames=Array.from({length:8},(_,i)=>({kind:'busy',inputNs:'1000',frameNs:'2000',sequence:i}));
    frames.push(...Array.from({length:6},(_,i)=>({kind:'saved-state',sequence:i+1,frameNs:'4000'})));
    const canvas={width:720,height:960,hidden:false,contextLost:false,render:{triangles:1}};
    const world={diagnostics:{animals:{ready:true,count}}};
    report.cases.push({fixture,backend,pair,run:`${fixture}-${backend}-${pair}`,completed:true,replay:{completed:true},
      memory:{totals:{pssKiB:1024}},actions:Array.from({length:7},(_,i)=>({action:i===6?'report':i%2?'early':'start',sequence:i,inputNs:'1000',savedNs:'3000'})),
      firstPresent:{actualNs:'2000'},initial:{activityCreatedNs:'0',loadStartNs:'500',databaseReadyNs:'750',worldSubmittedNs:'1000',canvas:structuredClone(canvas),world:structuredClone(world)},
      final:{completed:true,sequence:8,commonUiFrames:frames,canvas:structuredClone(canvas),world:structuredClone(world)},reportInputToPresentMs:1,
      runtime:{runtimeEnabled:true,resources:{nativeAnimals:{updates:1}}},worldUpdate:{after:{nativeAnimals:{count,updates:2}}}});
  }
  assert.equal(summarizeP2Costs(report).rows.length,4);
  const missing=structuredClone(report);missing.cases.find(c=>c.backend==='web').final.world.diagnostics.animals.ready=false;
  assert.throws(()=>summarizeP2Costs(missing),/animals must be ready/);
  const scaled=structuredClone(report);scaled.cases.find(c=>c.backend==='web').final.canvas.width=1440;
  assert.throws(()=>summarizeP2Costs(scaled));
  const backwards=structuredClone(report);backwards.cases[0].actions[0].savedNs='1';
  assert.throws(()=>summarizeP2Costs(backwards),/clock order/);
});
