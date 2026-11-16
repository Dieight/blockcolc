import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {summarizeP2Costs,summarizeP2Persistence} from './p2-cost-summary.mjs';

// Close the explicit P2 measurement correction. Never overwrite the historical
// audit, turn a timeout into a pass, run phone actions, or start P3.
const [destination]=process.argv.slice(2);if(!destination)throw Error('New checkpoint directory required');
const root=fileURLToPath(new URL('../../../',import.meta.url)),output=path.resolve(destination);
const round='artifacts/experiments/v3.0.0/p2-cost-correction-20261024',evidence=[],source=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(output,{recursive:false});
async function bytes(name){const data=await readFile(path.join(root,name));evidence.push({path:name,bytes:data.length,sha256:hash(data)});return data;}
async function json(name){return JSON.parse((await bytes(name)).toString('utf8').replace(/^\uFEFF/,''));}
async function copy(name,target){const data=await bytes(name),file=path.join(output,target);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data,{flag:'wx'});}
const previous=await json('artifacts/experiments/v3.0.0/p2-stage-complete/report.json');
assert.equal(previous.p2FunctionalGatePassed,true);assert.equal(previous.p3Started,false);
const cost=await json(`${round}/integrated-five/report.json`),integrated=summarizeP2Costs(cost),persistence=summarizeP2Persistence(cost);
for(const fixture of cost.fixtures)for(let pair=0;pair<5;pair++){
  const n=cost.cases.find(c=>c.fixture===fixture&&c.backend==='native'&&c.pair===pair),w=cost.cases.find(c=>c.fixture===fixture&&c.backend==='web'&&c.pair===pair);
  assert.equal(n.final.final,w.final.final,'all complete facts must match');
  for(const key of ['kind','sha256','bytes','wireSha256'])assert.equal(n.resourcePack[key],w.resourcePack[key]);
  const before=n.worldUpdate.before.owners,after=n.worldUpdate.after.owners;
  assert.deepEqual(Object.keys(before).sort(),Object.keys(after).sort());
  for(const owner of Object.keys(before))if(owner!=='building:complex-0')assert.deepEqual(before[owner],after[owner]);
}
for(const c of cost.cases)for(const suffix of ['-initial.png','.png','.json','-formal-replay.json'])await bytes(`${round}/integrated-five/${c.run}${suffix}`);
const review=await json(`${round}/visual-review.json`);
assert.equal(review.acceptedForRepresentativeP2,true);assert.equal(review.integratedReport,'integrated-five/report.json');
await bytes(`${round}/${review.allTwentyFinalWorlds}`);for(const name of review.fullResolutionReviewed)await bytes(`${round}/${name}`);

const apkFile=`${round}/native-known-commit.apk`,apkBytes=await bytes(apkFile),apkSha=hash(apkBytes);
assert.equal(cost.apkSha256,apkSha);
const originalTests=hash(await bytes(`${round}/native-known-commit-tests.apk`)),freshTests=hash(await bytes(`${round}/native-fresh-tree-tests.apk`));
const capacity=await json(`${round}/capacity-allowed-final/report.json`),crash=await json(`${round}/crash-final/report.json`),
  foreground=await json(`${round}/foreground-fresh-tree/report.json`),background=await json(`${round}/background-exact-final/report.json`);
for(const report of [capacity,crash,foreground,background]){assert.equal(report.completed,true);assert.equal(report.restored.database,true);assert.equal(report.apkSha256,apkSha);}
assert.equal(capacity.testApkSha256,originalTests);assert.equal(crash.testApkSha256,originalTests);assert.equal(foreground.testApkSha256,freshTests);
assert.equal(capacity.cases.length,4);assert.ok(capacity.cases.find(c=>c.name==='capacity').wireBytes>10*1024*1024);
assert.equal(capacity.cases.find(c=>c.name==='capacity-limits').priorStateRetained,true);
assert.equal(crash.recovery.priorStateAndNoOrphanRollback,true);assert.equal(crash.recovery.sameRequestRetryExactlyOnce,true);
assert.notEqual(crash.recovery.killedPid,crash.recovery.recoveryPid);
assert.equal(foreground.tests,5);assert.equal(foreground.replay.completed,true);assert.equal(background.cases.length,4);
assert.ok(background.cases.every(c=>c.completed&&c.databaseRestored));
assert.equal(background.policy,'exact-only');assert.ok(background.cases.every(c=>c.capabilities.notify===false&&c.capabilities.exact===true));

// Do not conceal the failed attempts or infer a proven freezing cause merely
// because a later battery-policy run passes.
const timeout=await json(`${round}/capacity-final/report.json`);assert.equal(timeout.completed,false);assert.equal(timeout.restored.database,true);
const stale=await json(`${round}/foreground-final/report.json`);assert.equal(stale.completed,false);assert.equal(stale.restored.database,true);
const mixed=await json(`${round}/background-final/report.json`);assert.equal(mixed.completed,false);assert.equal(mixed.restored.database,true);
for(const name of ['foreground-final/instrumentation.log','foreground-final/p2-flow-failure.png','foreground-final/p2-flow-failure.xml',
  'capacity-timeout-filtered.txt','capacity-allowed-final/instrumentation.log','crash-final/report.json','foreground-fresh-tree/instrumentation.log',
  'foreground-fresh-tree/formal-replay.json','foreground-fresh-tree/p2-flow-statistics.png'])await bytes(`${round}/${name}`);
const restoration=await json(`${round}/device-restored-final.json`);assert.equal(restoration.completed,true);
assert.equal(restoration.previewStopped,true);assert.equal(restoration.batteryOriginal,restoration.batteryRestored);
assert.equal(restoration.globalIdleForced,false);assert.equal(restoration.globalIdleState,'ACTIVE');assert.doesNotMatch(restoration.preferences,/beforeTest/);
assert.match(restoration.notifications,/granted=false/);assert.match(restoration.exactAlarm,/deny/);
assert.equal(restoration.platformCapabilities.pureRead,true);assert.equal(restoration.platformCapabilities.notify,false);
assert.equal(restoration.platformCapabilities.exact,false);assert.equal(restoration.platformCapabilities.ignoringBatteryOptimizations,false);
await bytes(`${round}/platform-capabilities-after.json`);await bytes(`${round}/platform-capabilities-inspection.log`);await bytes(`${round}/native-restoration-tests.apk`);
for(const name of ['battery-before.xml','battery-allowed.xml','restore-battery-after.xml'])await bytes(`${round}/${name}`);

// Rendering inputs and platform/domain/timer code did not change. Bind reuse
// of the older P1 and long/forced-Doze observations to their actual source and
// asset identity, without relabelling them as runs of this new APK.
const oldSources=new Map(previous.source.map(s=>[s.path,s.sha256])),reusedSources=[];
for(const [name,sha]of oldSources)if(name.includes('/src/main/')&&(
  ['world-core','world-filament','domain-core','focus-core','state-store-android'].some(m=>name.startsWith(`apps/native-android/${m}/`))||name.endsWith('/FocusPlatform.kt'))){
  assert.equal(hash(await bytes(name)),sha,'changed earlier platform/world input: '+name);reusedSources.push(name);
}
assert.ok(reusedSources.length>30);
const oldApk=await bytes('artifacts/experiments/v3.0.0/p2-finish-20261023/native-ready-world.apk');
function assets(raw){return Object.fromEntries(Object.entries(unzipSync(raw,{filter:e=>!e.name.endsWith('/')&&(e.name.startsWith('assets/')&&!e.name.startsWith('assets/web/')||e.name.startsWith('lib/'))})).map(([name,data])=>[name,hash(data)]));}
const assetsBefore=assets(oldApk),assetsAfter=assets(apkBytes);assert.deepEqual(assetsAfter,assetsBefore,'world/material/native-library input changed');
await writeFile(path.join(output,'unchanged-world-platform-inputs.json'),JSON.stringify({source:reusedSources,assets:assetsAfter,
  scope:'Unchanged source/input proof for explicit reuse of prior P1 and long/Doze platform observations. New storage/runtime changes have fresh foreground/background/capacity/crash and integrated tests. Not byte-identical entire APKs.'},null,2),{flag:'wx'});

const jvm=[];
for(const [module,count]of [['domain-core',9],['state-store',28],['focus-core',14],['app',4]]){
  const dir=`apps/native-android/${module}/build/test-results/${module==='app'?'testDebugUnitTest':'test'}`;let tests=0;
  for(const name of (await readdir(path.join(root,dir))).filter(n=>n.endsWith('.xml'))){
    const raw=(await bytes(`${dir}/${name}`)).toString(),head=raw.match(/<testsuite\b[^>]*>/)?.[0];assert.ok(head);
    const attrs=Object.fromEntries([...head.matchAll(/(\w+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    assert.equal(Number(attrs.failures)+Number(attrs.errors)+Number(attrs.skipped),0);tests+=Number(attrs.tests);await copy(`${dir}/${name}`,`jvm/${module}/${name}`);
  }
  assert.equal(tests,count);jvm.push({module,tests,failures:0,errors:0,skipped:0});
}
for(const name of ['state-oracle','command-oracle']){
  const relative=`apps/native-android/domain-core/build/generated/${name}/${name}.json`,oracle=await json(relative);
  for(const [file,sha]of Object.entries(oracle.sourceHashes))assert.equal(hash(await bytes(file)),sha,'stale oracle');
  await copy(relative,`oracles/${name}.json`);
}
const lint=(await bytes('apps/native-android/app/build/reports/lint-results-debug.txt')).toString().trim().split('\n').at(-1).trim();assert.match(lint,/^0 errors,/);
const toolLog=(await bytes(`${round}/tools-final.log`)).toString();assert.match(toolLog,/tests 59/);assert.match(toolLog,/pass 59/);assert.match(toolLog,/fail 0/);
for(const name of ['known-commit-build.log','accessibility-test-build.log','tools-final.log'])await copy(`${round}/${name}`,`logs/${name}`);
const standard='artifacts/verification/v2.9.0/build-104-a1863a7cddf5481fa82b1eea9a6af46d/Blockcolc-v2.9.0-verification.apk';
const standardSha=hash(await bytes(standard));assert.equal(standardSha,previous.formal104Unchanged.standardSha256);
const privateSha=hash(await readFile('C:/Codex/blockcolc-relay-private/artifacts/integrated-20261023-195643/Blockcolc-v2.9.0-private-verification.apk'));
assert.equal(privateSha,previous.formal104Unchanged.privateSha256);
async function freeze(relative){
  for(const item of await readdir(path.join(root,relative),{withFileTypes:true})){
    if(item.isDirectory()){if(!['build','.gradle','.idea','node_modules','artifacts'].includes(item.name))await freeze(`${relative}/${item.name}`);continue;}
    if(!/\.(kt|kts|gradle|md|mjs|ts|json|html|ps1|mat|glsl|xml|txt)$/.test(item.name)&&item.name!=='gradle.properties')continue;
    const name=`${relative}/${item.name}`,data=await readFile(path.join(root,name));source.push({path:name,bytes:data.length,sha256:hash(data)});
    const file=path.join(output,'source',name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data,{flag:'wx'});
  }
}
await freeze('apps/native-android');
for(const name of ['ARCHITECTURE.md','docs/TODO.md','docs/versions/3.0.0-development.md','docs/research/3.0.0-native-migration-plan.md'])await copy(name,`source/${name}`);
const benefit=cost.fixtures.map(fixture=>{
  const n=integrated.rows.find(r=>r.fixture===fixture&&r.backend==='native').metrics,w=integrated.rows.find(r=>r.fixture===fixture&&r.backend==='web').metrics;
  return {fixture,reportSpeedRatio:w.reportInputToWorldPresentedMs.median/n.reportInputToWorldPresentedMs.median,pssFraction:n.pssMiB.median/w.pssMiB.median,
    worldFaster:n.reportInputToWorldPresentedMs.median<w.reportInputToWorldPresentedMs.median,lessMemory:n.pssMiB.median<w.pssMiB.median};
});
assert.ok(benefit.every(r=>r.worldFaster&&r.lessMemory),'no observed integrated net benefit');
const report={schema:2,kind:'p2-corrected-stage-assessment',assessedAt:new Date().toISOString(),p2FunctionalGatePassed:true,p2MeasurementBoundaryPassed:true,
  p2IntegratedNetBenefitObserved:true,p3Started:false,fullAppGatePassed:false,apk:apkSha,testApks:{capacityCrash:originalTests,foreground:freshTests},
  supersedes:'The previous audit remains historical. Its legacy savedNs pure-saving interpretation is withdrawn; schema-2 fact-commit acknowledgements and diagnostic boundaries replace that inference, not its raw observations.',
  jvm,tools:{tests:59,failures:0},lint,integrated,persistence,benefit,
  checks:{capacity:capacity.cases,crash:crash.recovery,foreground:{tests:5,replay:foreground.replay},background:{currentShortCases:4,capabilityMode:background.policy,
    batteryDuringTests:'fully allowed, explicitly restored after completion',olderLongAndDoze:previous.deviceChecks.background,scope:'Older long/Doze reports remain tied to their older platform APK, not claimed as fresh runs.'},restoration},
  retainedFailures:{capacityTimeout:`${round}/capacity-final/report.json`,staleAccessibility:`${round}/foreground-final/report.json`,mixedCapabilityGuard:`${round}/background-final/report.json`,
    scope:'Same App APK passes capacity with background behavior allowed; this single-variable observation does not by itself prove the exact cause of the interrupted instrumentation. Foreground failure screenshot shows the real button; test fix refreshes public accessibility cache without bypassing it.'},
  bounds:['Representative P2 closure only; no complete native App, general building generator, final UI approval or P4 startup claim.',
    '17MiB actual capacity succeeds; 100MiB wire and 512MiB expansion guards are not arbitrary-valid-input heap guarantees.',
    'SQLite also saves plan/auth/idempotence atomically; reference IndexedDB comparison omits the separate formal local-plan store. Engine acknowledgement is not equal power-loss policy.',
    'Background remains subject to OEM policy. Restoring correct absolute facts in foreground is not punctual background execution under smart optimization.'],
  decision:'The P2 functional loop, affected failure recovery and corrected bounded integrated-cost evidence are complete. P3 has not begun; general generation and remaining feature/UI migration retain their original later-phase scope.',
  formal104Unchanged:{standardSha256:standardSha,privateSha256:privateSha},source,evidence};
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({p2FunctionalGatePassed:true,p2MeasurementBoundaryPassed:true,p2IntegratedNetBenefitObserved:true,p3Started:false,fullAppGatePassed:false,benefit,output}));
