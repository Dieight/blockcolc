import assert from 'node:assert/strict';

export function sampleSummary(values){
  assert.ok(values.length>0&&values.every(Number.isFinite),'complete numeric samples');
  const sorted=values.toSorted((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return {values,median:sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2,range:[sorted[0],sorted.at(-1)]};
}
const elapsed=(end,start)=>{
  assert.match(String(end),/^\d+$/);assert.match(String(start),/^\d+$/);
  const delta=BigInt(end)-BigInt(start);assert.ok(delta>=0n,'monotonic clock order');return Number(delta)/1e6;
};

/** Shared logical endpoint: the facts transaction has completed successfully.
 * This includes the path to that acknowledgement, not only disk time. Native
 * also persists plan/auth/receipts; a first start may commit its plan first. */
export function summarizeP2Operation(operation,backend){
  const t=operation.timing;assert.equal(t?.schema,2,'old harness-return timestamp is not a persistence measurement');assert.equal(t.backend,backend);
  assert.ok(t.transactions.length>0);assert.ok(t.transactions.every(tx=>tx.ok===true),'failed or unfinished transactions are not cost evidence');
  const facts=t.transactions.filter(tx=>tx.facts);assert.ok(facts.length>0,'actual fact commit required');
  const m=t.marks,returned=backend==='native'?m.coordinatorReturnedNs:m.serviceReturnedNs;
  const started=backend==='native'?m.actorStartedNs:m.serviceStartedNs;
  for(const tx of t.transactions){elapsed(tx.endNs,tx.beginNs);if(backend==='native'){elapsed(tx.bodyEndNs,tx.beginNs);elapsed(tx.endNs,tx.bodyEndNs);}}
  for(const span of t.spans){assert.equal(span.ok,true);elapsed(span.endNs,span.beginNs);}
  const committed=facts.at(-1).endNs;elapsed(returned,committed);elapsed(operation.savedNs,returned);elapsed(started,operation.inputNs);
  if(backend==='web'){assert.ok(m.repositorySaveAcknowledgedNs);elapsed(m.repositorySaveAcknowledgedNs,committed);elapsed(returned,m.repositorySaveAcknowledgedNs);}
  else{elapsed(m.adoptedNs,returned);elapsed(m.actorFinishedNs,m.adoptedNs);elapsed(operation.savedNs,m.actorFinishedNs);}
  const sum=name=>t.spans.filter(s=>s.name===name).reduce((total,s)=>total+elapsed(s.endNs,s.beginNs),0);
  return {action:operation.action,sequence:operation.sequence,factTransactions:facts.length,
    inputToFactCommitAckMs:elapsed(committed,operation.inputNs),inputToBusinessReturnMs:elapsed(returned,operation.inputNs),
    inputToHarnessReturnMs:elapsed(operation.savedNs,operation.inputNs),businessMs:elapsed(returned,started),
    postCommitBusinessMs:elapsed(returned,committed),
    factTransactionsMs:facts.reduce((total,tx)=>total+elapsed(tx.endNs,tx.beginNs),0),
    postBusinessHostMs:elapsed(operation.savedNs,returned),diagnosticJournalMs:sum('test-journal'),
    ...(backend==='native'?{hostAdoptionMs:sum('host-adoption'),backupRootsMs:sum('backup-roots'),platformMs:sum('platform-projection'),liveDiagnosticMs:sum('test-live-diagnostic'),
      coordinatorTransactionsMs:t.transactions.filter(tx=>BigInt(tx.endNs)<=BigInt(returned)).reduce((total,tx)=>total+elapsed(tx.endNs,tx.beginNs),0),
      coordinatorQueryExecuteMs:t.transactions.filter(tx=>BigInt(tx.endNs)<=BigInt(returned)).reduce((total,tx)=>total+Number(BigInt(tx.queryNs)+BigInt(tx.executeNs))/1e6,0)}:
      {repositorySaveMs:sum('repository-save')})};
}

/** Cost-Activity boundary, never a whole-final-App cold-start or FPS claim. */
export function summarizeP2Costs(report){
  assert.equal(report.completed,true);assert.equal(report.repeats,5);assert.equal(report.cases.length,20);
  assert.deepEqual(report.fixtures,['ocean','coast']);assert.equal(report.restored.database,true);
  assert.equal(new Set(report.cases.map(c=>c.run)).size,20);
  const rows=[];
  for(const fixture of report.fixtures)for(const backend of ['native','web']){
    const cases=report.cases.filter(c=>c.fixture===fixture&&c.backend===backend).toSorted((a,b)=>a.pair-b.pair);
    assert.deepEqual(cases.map(c=>c.pair),[0,1,2,3,4]);
    const perCase=cases.map(c=>{
      assert.equal(c.completed,true);assert.equal(c.replay.completed,true);assert.equal(c.final.completed,true);assert.equal(c.final.sequence,8);
      assert.ok(c.memory.totals.pssKiB>0);assert.equal(c.actions.length,7);
      if(backend==='web'){
        for(const state of [c.initial.canvas,c.final.canvas]){
          assert.equal(state.width,720);assert.equal(state.height,960);assert.equal(state.contextLost,false);assert.equal(state.hidden,false);
          assert.ok(state.render.triangles>0);
        }
        assert.equal(c.initial.world.diagnostics.animals.ready,true);
        assert.equal(c.final.world.diagnostics.animals.ready,true,'source animals must be ready, not only the static geometry');
        assert.equal(c.final.world.diagnostics.animals.count,c.initial.world.diagnostics.animals.count);
      }else{
        assert.equal(c.runtime.runtimeEnabled,true);assert.ok(c.worldUpdate.after.nativeAnimals.count>0);
        assert.ok(c.worldUpdate.after.nativeAnimals.updates>c.runtime.resources.nativeAnimals.updates);
      }
      assert.ok(BigInt(c.firstPresent.actualNs)>=BigInt(c.initial.worldSubmittedNs));
      const commands=c.actions.filter(a=>a.action==='start'||a.action==='early');assert.equal(commands.length,6);
      const busy=c.final.commonUiFrames.filter(f=>f.kind==='busy');assert.equal(busy.length,8);
      const savedFrames=commands.map(a=>{
        const frame=c.final.commonUiFrames.find(f=>f.kind==='saved-state'&&f.sequence===a.sequence+1);assert.ok(frame);
        return elapsed(frame.frameNs,a.inputNs);
      });
      return {run:c.run,
        activityToWorldPresentedMs:elapsed(c.firstPresent.actualNs,c.initial.activityCreatedNs),
        databaseValidationMs:elapsed(c.initial.databaseReadyNs,c.initial.loadStartNs),
        databaseLoadStartToWorldPresentedMs:elapsed(c.firstPresent.actualNs,c.initial.loadStartNs),
        reportInputToWorldPresentedMs:c.reportInputToPresentMs,
        pssMiB:c.memory.totals.pssKiB/1024,
        focusInputToHarnessReturnMs:sampleSummary(commands.map(a=>elapsed(a.savedNs,a.inputNs))),
        focusInputToComposeProjectionMs:sampleSummary(savedFrames),
        busyComposeCallbackMs:sampleSummary(busy.map(f=>elapsed(f.frameNs,f.inputNs)))};
    });
    const metrics={};
    for(const name of ['activityToWorldPresentedMs','databaseValidationMs','databaseLoadStartToWorldPresentedMs','reportInputToWorldPresentedMs','pssMiB'])metrics[name]=sampleSummary(perCase.map(c=>c[name]));
    for(const name of ['focusInputToHarnessReturnMs','focusInputToComposeProjectionMs','busyComposeCallbackMs'])metrics[name]=sampleSummary(perCase.map(c=>c[name].median));
    rows.push({fixture,backend,metrics,perCase});
  }
  return {scope:report.scope,rows,
    timing:'All times use the device monotonic clock. World timing uses actual SurfaceFlinger presentation fences; Compose callbacks are projection observations, not actual displayed-frame fences.',
    sampling:'Five AB/BA pairs per fixture. Operation summaries are five per-run medians, not thirty independent runs or a reliable P99.',
    limitations:['Activity-to-world includes reference WebView/fixture-seed setup, whereas native fixture seeding ran before the Activity. Keep that interval as an inclusive harness observation, not a matched App-startup gate. Database-load intervals start after fixture preparation on each side, but reference preparation warmed its repository in the same process whereas native reopened from a fresh process; these are diagnostics, not a matched database-engine benchmark.',
      'Source uses the real production renderer but excludes React shell and persistent scene-cache wiring. This is not a current formal-App cache-hit comparison.',
      'Native uses the explicit bounded first-workshop construction cache; its offline time/bytes must be reported separately. This is not a general native terrain/building generator.',
      'The legacy savedNs endpoint is a harness-return marker: native includes host adoption/platform/test diagnostics, source does not include the same work. Do not label its difference as pure saving or a database regression. Schema-2 transaction measurements are assessed separately.',
      'Source notification adapter is denied/no-op; native includes its real coordinator/store. An engine commit acknowledgement is not proof of equal physical fsync policies.']};
}

export function summarizeP2Persistence(report){
  const integrated=summarizeP2Costs(report);
  const rows=integrated.rows.map(row=>{
    const cases=report.cases.filter(c=>c.fixture===row.fixture&&c.backend===row.backend).toSorted((a,b)=>a.pair-b.pair);
    const perCase=cases.map(c=>({run:c.run,operations:c.actions.map(op=>summarizeP2Operation(op,row.backend))}));
    const names=['inputToFactCommitAckMs','inputToBusinessReturnMs','inputToHarnessReturnMs','businessMs','postCommitBusinessMs','factTransactionsMs','postBusinessHostMs','diagnosticJournalMs',
      ...(row.backend==='native'?['hostAdoptionMs','backupRootsMs','platformMs','liveDiagnosticMs','coordinatorTransactionsMs','coordinatorQueryExecuteMs']:['repositorySaveMs'])];
    const metrics=Object.fromEntries(names.map(name=>[name,sampleSummary(perCase.map(c=>sampleSummary(c.operations.filter(op=>op.action!=='report').map(op=>op[name])).median))]));
    const withoutFirstStart=Object.fromEntries(names.map(name=>[name,sampleSummary(perCase.map(c=>sampleSummary(c.operations.filter(op=>op.action!=='report'&&op.sequence!==0).map(op=>op[name])).median))]));
    return {fixture:row.fixture,backend:row.backend,metrics,withoutFirstStart,perCase};
  });
  return {schema:2,rows,
    boundary:'Input to acknowledgement of the last successfully completed fact transaction, then business-return, host adoption and diagnostics separately. Not pure disk time. Native first-start also confirms the durable local plan; the separate withoutFirstStart summary excludes that extra setup.',
    limitations:['SQLite saves facts, local recovery, automatic authorization and request receipts atomically; IndexedDB saves formal facts, while the formal local-plan side store is not included here. This is a comparison of the implemented business paths, not an equal-payload database-engine benchmark.',
      'SQLite transaction return and IndexedDB complete acknowledge their respective engine policies; no assertion that their power-loss durability is identical.',
      'Five per-run medians per fixture; first-start and report remain visible individually. World presentation/visual and whole-App startup limitations from the integrated comparison still apply.']};
}
