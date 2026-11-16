import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

// Stage assessment joins completed, identity-bound evidence. It does not run
// device tests, infer visual acceptance, install, publish, or start P2.
const [output]=process.argv.slice(2);if(!output)throw Error('Choose a new stage-audit JSON path');
const root=path.resolve(new URL('../../../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const base=path.join(root,'artifacts/experiments/v3.0.0'),evidence=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
async function json(name){const bytes=await readFile(path.join(base,name));evidence.push({path:name,sha256:sha(bytes)});return JSON.parse(bytes);}
const fingerprint='0dd7a4fc8a79f0aa495ac62c33fd4296152228712c1457e40b6d9afac8cc1c29';
const producer=await json('p1-final-producer-audit/source-inputs.json');assert.equal(producer.fingerprint,fingerprint);assert.equal(producer.files.length,477);
for(const f of producer.files)assert.equal(sha(await readFile(path.join(root,f.path))),f.sha256,'Formal producer changed: '+f.path);
const original=await json('p1-four-environment-current-checkpoint/report.json'),mc=await json('p1-mc263-current-checkpoint/report.json');
for(const [dir,c] of [['p1-four-environment-current-checkpoint',original],['p1-mc263-current-checkpoint',mc]]){
  assert.equal(c.package,'com.blockcolc.preview');assert.equal(c.jvm.tests,97);
  assert.deepEqual([c.jvm.failures,c.jvm.errors,c.jvm.skipped],[0,0,0]);assert.equal(c.producerFingerprint,fingerprint);
  assert.ok(c.nativeLibraries.every(l=>l.elf16kAligned));
  assert.equal(sha(await readFile(path.join(base,dir,'blockcolc-native-p1-foundation.apk'))),c.apk.sha256);
  for(const f of c.source.filter(f=>/\/app\/|\/world-core\/|\/world-filament\//.test(f.path)))
    assert.equal(sha(await readFile(path.join(root,f.path))),f.sha256,'Compiled module changed: '+f.path);
}
const originalInput=await json('p1-four-environment-source-first/manifest.json'),mcInput=await json('p1-mc263-prepared-source-final/manifest.json');
for(const m of [originalInput,mcInput]){assert.deepEqual(m.errors,[]);assert.ok(!m.inventoryOnly);assert.equal(m.producerFingerprint,fingerprint);}
assert.equal(sha(await readFile(path.join(base,'p1-mc263-prepared-source-final/resource-pack.json'))),mcInput.resourcePack.identity.wireSha256);
const offlineOriginal=await json('p1-four-environment-native-audit-final.json'),offlineMc=await json('p1-mc263-native-audit-final.json');
for(const r of [offlineOriginal,offlineMc]){assert.equal(r.completed,true);assert.equal(r.allAdmissible,true);assert.equal(r.producerFingerprint,fingerprint);}
const originals=await json('p1-four-environment-owner-device-first/report.json'),references=await json('p1-four-environment-reference-device-first/report.json');
const mcOwners=await json('p1-mc263-owner-device-first/report.json'),mcReference=await json('p1-mc263-reference-device-first/report.json');
for(const [r,apk,names]of [[originals,original.apk.sha256,['ocean','coast','valley','floating']],[mcOwners,mc.apk.sha256,['ocean','coast']]]){
  assert.equal(r.apkSha256,apk);assert.equal(r.ownerGpuChecksPassed,true);assert.equal(r.nonblankUpdateAndOrbitPassed,true);assert.equal(r.previewStopped,true);
  assert.deepEqual(r.cases.map(c=>c.fixture),names);for(const c of r.cases){assert.equal(c.cleanRetirement,true);assert.equal(c.unchangedOtherOwners,25);}
}
for(const [r,apk,names]of [[references,original.apk.sha256,['ocean','coast','valley','floating']],[mcReference,mc.apk.sha256,['ocean','coast']]]){
  assert.equal(r.apkSha256,apk);assert.equal(r.sourceFramesCaptured,true);assert.equal(r.previewStopped,true);assert.deepEqual(r.scenes.map(c=>c.fixture),names);
}
const formulas=await json('p1-atlas-formula-second/report.json');assert.equal(formulas.completed,true);assert.equal(formulas.passed,true);assert.equal(formulas.tolerance,2e-6);
assert.equal(formulas.groups.reduce((n,g)=>n+g.cases,0),1122);
const cascade=await json('p1-cascade-formula-first/report.json');assert.equal(cascade.completed,true);assert.equal(cascade.maximumDelta,0);
const tools=await readFile(path.join(base,'p1-final-tools-retirement.log'),'utf8');assert.match(tools,/tests 45/);assert.match(tools,/pass 45/);assert.match(tools,/fail 0/);
const metrics=[];
const median=v=>v.toSorted((a,b)=>a-b)[1],range=v=>[Math.min(...v),Math.max(...v)];
for(const [name,assets,apk] of [['p1-dynamic-rain-orbit-first','original','cf1d7646fa87ff0c6736887ef1e1e63f07f4972e23c5e4bb39b050fc4bd8118a'],['p1-mc263-dynamic-orbit-second','mc263',mc.apk.sha256]]){
  const r=await json(name+'/report.json');assert.equal(r.completed,true);assert.equal(r.apkSha256,apk);assert.equal(r.cases.length,12);assert.equal(r.repeat,3);assert.equal(r.previewStopped,true);
  for(const c of r.cases){assert.equal(c.completed,true);assert.ok(c.memory.totals.pssKiB>0);assert.equal(c.presentation.lowSampleCount,false);assert.equal(c.processesAfterStop.length,0);
    assert.ok(c.presentation.firstEdgeGapMs<=1000&&c.presentation.lastEdgeGapMs<=1000);
    if(c.backend==='OPENGL'){assert.equal(c.retirement.engineDestroyed,true);assert.equal(c.retirement.after.packets,0);}
    else assert.ok(c.memory.processes.some(p=>p.role==='isolated-webview'));
    if(assets==='mc263'){
      for(const k of ['kind','sha256','bytes','wireSha256'])assert.equal(c.resourcePack[k],mcInput.resourcePack.identity[k]);
      const raw=await json(name+'/'+c.runId+'.json');
      if(c.backend==='WEBGL')for(const side of ['before','after']){const b=raw[side];assert.equal(b.quality.qualityTier,'high');assert.equal(b.quality.pixelRatio,1);
        assert.equal(b.assets.diagnostics.activeLightingQuality,'cinematic');assert.equal(b.assets.diagnostics.bloomEnabled,true);assert.equal(b.assets.diagnostics.shaderDetail,'high');assert.equal(b.assets.diagnostics.worldRebuildCount,1);}
      else{assert.equal(raw.before.atlasSequences,11);assert.equal(raw.after.atlasSequences,11);assert.ok(raw.after.atlasUploadFrames>raw.before.atlasUploadFrames&&raw.after.atlasTimelineChanges>raw.before.atlasTimelineChanges);}
    }
  }
  for(const fixture of ['ocean','coast']){
    const rows={assets,fixture};
    for(const backend of ['OPENGL','WEBGL']){const c=r.cases.filter(c=>c.fixture===fixture&&c.backend===backend);assert.equal(c.length,3);
      rows[backend]={presentationsHz:median(c.map(c=>c.presentation.presentedUpdatesPerSecond)),presentationP95Ms:median(c.map(c=>c.presentation.presentIntervalP95Ms)),pssMiB:median(c.map(c=>c.memory.totals.pssKiB/1024)),
        presentationsHzRange:range(c.map(c=>c.presentation.presentedUpdatesPerSecond)),pssMiBRange:range(c.map(c=>c.memory.totals.pssKiB/1024))};}
    // Do not invent an FPS tolerance after collecting results. Preserve the
    // exact medians/ranges and require an explicit stage-level assessment.
    assert.ok(rows.OPENGL.presentationP95Ms<=rows.WEBGL.presentationP95Ms);
    rows.pssReductionPercent=(1-rows.OPENGL.pssMiB/rows.WEBGL.pssMiB)*100;metrics.push(rows);
  }
}
const reentry=await json('p1-mc263-reentry-device-first/report.json');assert.equal(reentry.completed,true);assert.equal(reentry.apkSha256,mc.apk.sha256);assert.equal(reentry.previewStopped,true);assert.equal(reentry.cases.length,4);
assert.equal(new Set(reentry.cases.map(c=>c.pid)).size,1);assert.ok(reentry.cases.every(c=>c.completed&&c.cleanRetirement));
const review=await json('p1-visual-review-final.json');assert.equal(review.acceptedForP1,true);assert.equal(review.pairs.length,8);
assert.equal(review.performanceAcceptedForP1,true);
const images=[];for(const pair of review.pairs)for(const file of pair)images.push({path:file,sha256:sha(await readFile(path.join(base,file)))});
const report={schema:1,kind:'p1-stage-assessment',assessedAt:new Date().toISOString(),p1GatePassed:true,p2Started:false,
  auditToolSha256:sha(await readFile(new URL('./audit-p1-stage.mjs',import.meta.url))),
  scope:'Representative world-renderer gate approved against the agreed plan; not a release gate or whole-App migration/performance acceptance.',
  producerFingerprint:fingerprint,device:reentry.serial,apks:{originalFour:original.apk,mc263:mc.apk},metrics,
  checks:['Four original environments, real source references, actual operation and GPU retirement','Controlled MC atlas/model/tint/UV/fluid/animation representation and same-pack reference','12 original dynamic rain and 12 MC dynamic orbit actual-presentation / complete-process-memory samples','Bounded owner replacement/failure/stale transactions with unaffected owners','Four same-PID native world entries and full engine/pool retirement','97 JVM, 45 tools, dual-backend material build and Android lint, agent image review'],
  limitations:['OnePlus/GLES only for this renderer gate; not proof of Vulkan or every GPU','Short bounded rotation windows after fixed-camera warmup, not fully warmed multi-lap steady state or App startup','Filament shadow coverage/filtering and sampling are not pixel-identical','Controlled source has 18 fallback voxels; the full block/model and weather/environment matrix remains P3','Production terrain generation, full data/business/UI/platform integration and net whole-App benefits are later stages','Partial exit-memory observations are unavailable, never counted as zero or substituted for complete active snapshots','The final accepted v2.9.0 APK baseline still needs fixing for P4'],
  evidence,images};
await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({p1GatePassed:true,p2Started:false,metrics,output}));
