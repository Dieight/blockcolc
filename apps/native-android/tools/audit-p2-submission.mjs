import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {summarizeSubmission} from './p2-submission-profile.mjs';
import {summarizeP2Operation} from './p2-cost-summary.mjs';

// This is a targeted follow-up, not another release gate or a new P3 decision.
const [destination]=process.argv.slice(2);if(!destination)throw Error('New checkpoint directory required');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const round='artifacts/experiments/v3.0.0/p2-submit-hotpath-20261024',output=path.resolve(destination),evidence=new Map(),source=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(output,{recursive:false});
async function bytes(name){const data=await readFile(path.join(root,name));evidence.set(name,{path:name,bytes:data.length,sha256:sha(data)});return data;}
async function json(name){return JSON.parse((await bytes(name)).toString('utf8').replace(/^\uFEFF/,''));}
async function copy(name,target){const data=await bytes(name),file=path.join(output,target);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data,{flag:'wx'});}

const previous=await json('artifacts/experiments/v3.0.0/p2-cost-correction-20261024/assessment-final/report.json');
assert.equal(previous.p2MeasurementBoundaryPassed,true);assert.equal(previous.p3Started,false);
const apk=sha(await bytes(`${round}/final-hotpath.apk`)),testApk=sha(await bytes(`${round}/final-hotpath-tests.apk`));
const profiles={};
for(const name of ['baseline','optimized','final-profile']){
 const report=await json(`${round}/${name}/report.json`),raw=await json(`${round}/${name}/device.json`);
 assert.equal(report.completed,true);assert.equal(report.databaseRestored,true);assert.equal(report.replays.length,5);assert.ok(report.replays.every(r=>r.completed&&r.commands===7&&r.transactions===7));
 const summary=summarizeSubmission(raw);profiles[name]=summary;
 assert.equal(report.apkSha256,sha(await bytes(`${round}/${name==='baseline'?'baseline-profile':name==='optimized'?'optimized-hotpath':'final-hotpath'}.apk`)));
 for(let group=0;group<5;group++)assert.equal((await json(`${round}/${name}/group-${group}-formal-replay.json`)).completed,true);
 await writeFile(path.join(output,name+'-summary.json'),JSON.stringify(summary,null,2),{flag:'wx'});
}
assert.equal(profiles.baseline.fixtureSha256,profiles['final-profile'].fixtureSha256);
assert.equal((await json(`${round}/final-profile/report.json`)).apkSha256,apk);
const a=profiles.baseline.groups.withoutFirstStart.metrics,b=profiles['final-profile'].groups.withoutFirstStart.metrics;
assert.ok(b.inputToFactCommitAckMs.median<a.inputToFactCommitAckMs.median);assert.ok(b.coordinatorWriteCalls.median<a.coordinatorWriteCalls.median);

const reports={};
for(const name of ['capacity','foreground','crash','background-short','integrated-preflight']){
 const r=await json(`${round}/${name}/report.json`);reports[name]=r;
 assert.equal(r.completed,true);assert.equal(r.restored.database,true);assert.equal(r.apkSha256,apk);
 if(r.testApkSha256)assert.equal(r.testApkSha256,testApk);
}
assert.equal(reports.capacity.cases.length,4);assert.ok(reports.capacity.cases.find(c=>c.name==='capacity').wireBytes>10*1024*1024);
assert.equal(reports.capacity.cases.find(c=>c.name==='capacity-limits').priorStateRetained,true);
assert.equal(reports.foreground.tests,5);assert.equal(reports.foreground.replay.completed,true);
assert.equal(reports.crash.recovery.priorStateAndNoOrphanRollback,true);assert.equal(reports.crash.recovery.sameRequestRetryExactlyOnce,true);
assert.notEqual(reports.crash.recovery.killedPid,reports.crash.recovery.recoveryPid);
assert.equal(reports['background-short'].policy,'exact-only');assert.equal(reports['background-short'].cases.length,4);
assert.ok(reports['background-short'].cases.every(c=>c.completed&&c.databaseRestored&&c.capabilities.exact&&!c.capabilities.notify));
const integrated=reports['integrated-preflight'];assert.equal(integrated.repeats,1);assert.equal(integrated.cases.length,4);
const activeWorld=[];
for(const fixture of ['ocean','coast']){
 const n=integrated.cases.find(c=>c.fixture===fixture&&c.backend==='native'),w=integrated.cases.find(c=>c.fixture===fixture&&c.backend==='web');
 for(const c of [n,w]){
  assert.equal(c.completed,true);assert.equal(c.replay.completed,true);assert.ok(c.reportInputToPresentMs>0);
  for(const suffix of ['.json','.png','-initial.png','-formal-replay.json'])await bytes(`${round}/integrated-preflight/${c.run}${suffix}`);
 }
 assert.equal(n.final.final,w.final.final);for(const key of ['sha256','bytes','wireSha256'])assert.equal(n.resourcePack[key],w.resourcePack[key]);
 const before=n.worldUpdate.before.owners,after=n.worldUpdate.after.owners;assert.deepEqual(Object.keys(before).sort(),Object.keys(after).sort());
 for(const owner of Object.keys(before))if(owner!=='building:complex-0')assert.deepEqual(before[owner],after[owner]);
 assert.ok(n.worldUpdate.after.nativeAnimals.updates>n.runtime.resources.nativeAnimals.updates);
 assert.equal(w.final.world.diagnostics.animals.ready,true);assert.equal(w.final.world.diagnostics.animals.count,w.initial.world.diagnostics.animals.count);
 activeWorld.push({fixture,scope:'One fresh matched pair: regression/preflight only, not a new five-pair benefit estimate',nativeReportMs:n.reportInputToPresentMs,sourceReportMs:w.reportInputToPresentMs,
  nativeOperations:n.actions.map(o=>summarizeP2Operation(o,'native')),sourceOperations:w.actions.map(o=>summarizeP2Operation(o,'web'))});
}
const review=await json(`${round}/visual-review.json`);assert.equal(review.acceptedForTargetedRegression,true);assert.equal(review.integratedReport,'integrated-preflight/report.json');
await bytes(`${round}/${review.collage}`);await bytes(`${round}/foreground/p2-flow-statistics.png`);
const restoration=await json(`${round}/device-restored.json`);assert.equal(restoration.completed,true);assert.equal(restoration.previewStopped,true);
assert.equal(restoration.batteryOriginal,restoration.batteryRestored);assert.equal(restoration.globalIdleForced,false);
assert.equal(restoration.platformCapabilities.pureRead,true);for(const k of ['notify','exact','ignoringBatteryOptimizations'])assert.equal(restoration.platformCapabilities[k],false);
for(const file of ['battery-before.xml','battery-allowed.xml','restore-battery-after.xml','platform-capabilities-after.json','platform-capabilities-inspection.log'])await bytes(`${round}/${file}`);

const jvm=[];
for(const [module,expected] of [['domain-core',16],['state-store',32],['focus-core',14],['app',4]]){
 let count=0;for(const name of (await readdir(path.join(root,round,`jvm-${module}`))).filter(n=>n.endsWith('.xml'))){
  const head=(await bytes(`${round}/jvm-${module}/${name}`)).toString().match(/<testsuite\b[^>]*>/)?.[0];assert.ok(head);
  const attrs=Object.fromEntries([...head.matchAll(/(\w+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));assert.equal(+attrs.failures + +attrs.errors + +attrs.skipped,0);count+=+attrs.tests;
 }
 assert.equal(count,expected);jvm.push({module,tests:count,failures:0});
}
for(const name of ['state-oracle','command-oracle']){
 const file=`apps/native-android/domain-core/build/generated/${name}/${name}.json`,oracle=await json(file);
 for(const [input,digest]of Object.entries(oracle.sourceHashes))assert.equal(sha(await bytes(input)),digest,'current formal oracle');
 await copy(file,`oracles/${name}.json`);
}
const lint=(await bytes(`${round}/lint-debug.xml`)).toString();assert.doesNotMatch(lint,/<issue\b[^>]*severity="(?:Error|Fatal)"/);
const tools=(await bytes(`${round}/node-tools-final.log`)).toString();assert.match(tools,/tests 62/);assert.match(tools,/pass 62/);assert.match(tools,/fail 0/);
await bytes(`${round}/reviewed-build.log`);
const oldSources=new Map(previous.source.map(s=>[s.path,s.sha256])),reused=[];
for(const [file,digest]of oldSources)if(file.includes('/src/main/')&&(['world-core','world-filament','state-store-android','focus-core'].some(m=>file.startsWith(`apps/native-android/${m}/`))||file.endsWith('/FocusPlatform.kt'))){
 if(file.endsWith('/FocusCoordinator.kt'))continue; // Redundant validation moved to store; fresh tests above.
 assert.equal(sha(await bytes(file)),digest,'untouched world/platform inputs');reused.push(file);
}
function assets(raw){return Object.fromEntries(Object.entries(unzipSync(raw,{filter:e=>!e.name.endsWith('/')&&(e.name.startsWith('assets/')&&!e.name.startsWith('assets/web/')||e.name.startsWith('lib/'))})).map(([name,b])=>[name,sha(b)]));}
assert.deepEqual(assets(await bytes(`${round}/final-hotpath.apk`)),assets(await bytes('artifacts/experiments/v3.0.0/p2-cost-correction-20261024/native-known-commit.apk')));
const standard='artifacts/verification/v2.9.0/build-104-a1863a7cddf5481fa82b1eea9a6af46d/Blockcolc-v2.9.0-verification.apk';
const standardSha256=sha(await bytes(standard));assert.equal(standardSha256,previous.formal104Unchanged.standardSha256);
const privateSha256=sha(await readFile('C:/Codex/blockcolc-relay-private/artifacts/integrated-20261023-195643/Blockcolc-v2.9.0-private-verification.apk'));assert.equal(privateSha256,previous.formal104Unchanged.privateSha256);
async function freeze(relative){for(const item of await readdir(path.join(root,relative),{withFileTypes:true})){
 if(item.isDirectory()){if(!['build','.gradle','.kotlin','node_modules','artifacts'].includes(item.name))await freeze(relative+'/'+item.name);continue;}
 if(!/\.(kt|gradle|properties|md|mjs|ts|json|html|ps1|mat|glsl|xml|txt)$/.test(item.name))continue;
 const file=relative+'/'+item.name,data=await readFile(path.join(root,file));source.push({path:file,bytes:data.length,sha256:sha(data)});
 const target=path.join(output,'source',file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data,{flag:'wx'});
}}
await freeze('apps/native-android');for(const file of ['ARCHITECTURE.md','docs/TODO.md','docs/versions/3.0.0-development.md'])await copy(file,'source/'+file);
const report={schema:1,kind:'p2-submission-optimization-assessment',assessedAt:new Date().toISOString(),p2TargetedOptimizationPassed:true,p3Started:false,fullAppGatePassed:false,apk,testApk,
 fixtureSha256:profiles.baseline.fixtureSha256,focusedComparison:{before:a,after:b,inputToCommitReduction:1-b.inputToFactCommitAckMs.median/a.inputToFactCommitAckMs.median},activeWorld,
 jvm,tools:{tests:62,failures:0},lintErrors:0,deviceRestored:true,unchangedRenderingAndPlatformSources:reused,formal104Unchanged:{standardSha256,privateSha256},
 limitations:['Focused before/after: five groups each, real actor+SQLite, no rendered-world contention, first plan setup and report kept separate. Not whole-App startup or a database-engine durability comparison.',
 'The intermediate optimization and every raw run are retained. Scalar/grammar/calendar caches and private document copies are bounded; full document and cross-record validation remain enabled.',
 'The active-world comparison is one fresh pair per fixture, only a regression/preflight. Prior five-pair world/PSS evidence remains a historical checkpoint, not newly measured results for this APK.',
 'Fresh regressions cover UI/report/world, short background, large backup and actual process death. Prior long/forced-Doze results remain historical; this is not a rerun of the complete P2/P4 or formal release gate.'],source,evidence:[...evidence.values()]};
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({passed:true,apk,p3Started:false,sourceFiles:source.length,evidenceFiles:evidence.size,reduction:report.focusedComparison.inputToCommitReduction}));
