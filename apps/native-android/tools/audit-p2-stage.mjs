import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {summarizeP2Costs} from './p2-cost-summary.mjs';

// Frozen stage assessment only. Does not run phone tests, infer image review,
// grant permissions, publish a formal package, or start P3.
const [output]=process.argv.slice(2);if(!output)throw Error('Choose a new checkpoint directory');
const root=fileURLToPath(new URL('../../../',import.meta.url)),out=path.resolve(output);
await mkdir(out,{recursive:false});
const finish='artifacts/experiments/v3.0.0/p2-finish-20261023',resume='artifacts/experiments/v3.0.0/p2-resume-20261023';
const evidence=[],source=[],sha=b=>createHash('sha256').update(b).digest('hex');
async function bytes(relative){
  const data=await readFile(path.join(root,relative));evidence.push({path:relative,bytes:data.length,sha256:sha(data)});return data;
}
async function json(relative){return JSON.parse((await bytes(relative)).toString('utf8').replace(/^\uFEFF/,''));}
async function copy(relative,destination){const data=await bytes(relative),target=path.join(out,destination);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data,{flag:'wx'});}
const proof=await json(`${finish}/p2-visual-review-final.json`);assert.equal(proof.acceptedForRepresentativeP2,true);
assert.equal(proof.integratedReport,'integrated-ready-five/report.json');
const cost=await json(`${finish}/${proof.integratedReport}`),metrics=summarizeP2Costs(cost);
const same=(a,b)=>assert.deepEqual(JSON.parse(a),JSON.parse(b),'complete final native/source facts');
for(const fixture of cost.fixtures)for(let pair=0;pair<5;pair++){
  const n=cost.cases.find(c=>c.fixture===fixture&&c.pair===pair&&c.backend==='native'),w=cost.cases.find(c=>c.fixture===fixture&&c.pair===pair&&c.backend==='web');
  same(n.final.final,w.final.final);
  for(const k of ['kind','sha256','wireSha256','bytes'])assert.equal(n.resourcePack[k],w.resourcePack[k]);
  const before=n.worldUpdate.before.owners,after=n.worldUpdate.after.owners;
  assert.deepEqual(Object.keys(before).sort(),Object.keys(after).sort());
  for(const owner of Object.keys(before))if(owner!=='building:complex-0')assert.deepEqual(before[owner],after[owner],'unchanged owner '+owner);
}
for(const c of cost.cases){
  for(const suffix of ['-initial.png','.png','.json','-formal-replay.json'])await bytes(`${finish}/integrated-ready-five/${c.run}${suffix}`);
}
await bytes(`${finish}/${proof.allTwentyFinalWorlds}`);for(const p of proof.fullResolutionReviewed)await bytes(`${finish}/${p}`);
const prior=await json(`${finish}/integrated-matched-five/report.json`);
assert.throws(()=>summarizeP2Costs(prior),/animals must be ready/,'do not reuse the static-only preliminary result');

const capacity=await json(`${finish}/capacity-owned-first/report.json`),crash=await json(`${finish}/crash-owned-first/report.json`);
const foreground=await json(`${finish}/foreground-matched-final/report.json`),background=await json(`${finish}/background-matched-final/report.json`);
for(const r of [capacity,crash,foreground,background]){assert.equal(r.completed,true);assert.equal(r.restored.database,true);}
assert.equal(capacity.cases.length,4);assert.ok(capacity.cases.find(c=>c.name==='capacity').wireBytes>10*1024*1024);
assert.equal(capacity.cases.find(c=>c.name==='capacity-limits').priorStateRetained,true);
assert.equal(crash.recovery.priorStateAndNoOrphanRollback,true);assert.equal(crash.recovery.sameRequestRetryExactlyOnce,true);
assert.notEqual(crash.recovery.killedPid,crash.recovery.recoveryPid);
assert.equal(foreground.tests,5);assert.equal(foreground.replay.completed,true);
assert.equal(background.cases.length,4);assert.ok(background.cases.every(c=>c.completed&&c.databaseRestored));
const longer=await json(`${finish}/background-extended-home/report.json`),doze=await json(`${finish}/background-deep-idle-first/report.json`);
for(const r of [longer,doze]){assert.equal(r.completed,true);assert.equal(r.restored.database,true);}
assert.equal(doze.cases[0].idleDuring.forced,true);assert.equal(doze.cases[0].idleDuring.deep,'IDLE');assert.equal(doze.restored.globalIdle.forced,false);
const restricted=await json(`${finish}/background-smart-earlyfix/report.json`);assert.equal(restricted.completed,false);assert.equal(restricted.restored.database,true);
const restored=await json(`${finish}/device-restored-after-cost.json`);assert.equal(restored.completed,true);assert.equal(restored.previewStopped,true);
assert.equal(restored.batteryOriginal,restored.batteryRestored);assert.equal(restored.globalIdleForced,false);assert.equal(restored.globalIdleState,'ACTIVE');
assert.match(restored.notifications,/granted=false/);assert.match(restored.exactAlarm,/deny/);assert.doesNotMatch(restored.preferences,/beforeTest/);
for(const name of ['battery-before.xml','restore-battery-after.xml','restore-notifications-after.xml','restore-exact-after.xml'])await bytes(`${finish}/${name}`);

// Later APKs only changed the local Web reference. Bind reuse to actual ZIP
// payloads, not to a claim that the source looked unchanged.
async function payload(file){
  const raw=await bytes(file),entries=unzipSync(raw,{filter:e=>!e.name.endsWith('/')&&!e.name.startsWith('META-INF/')&&!e.name.startsWith('assets/web/')});
  const hashes=Object.fromEntries(Object.entries(entries).sort(([a],[b])=>a.localeCompare(b)).map(([name,data])=>[name,sha(data)]));
  return {file,sha256:sha(raw),bytes:raw.length,hashes};
}
const apks=[];
for(const name of ['native-owned-read.apk','native-matched-output.apk','native-ready-world.apk'])apks.push(await payload(`${finish}/${name}`));
for(const apk of apks.slice(1))assert.deepEqual(apk.hashes,apks[0].hashes,'native/runtime/world data changed; retest affected device paths');
assert.equal(capacity.apkSha256,apks[0].sha256);assert.equal(crash.apkSha256,apks[0].sha256);
assert.equal(foreground.apkSha256,apks[1].sha256);assert.equal(background.apkSha256,apks[1].sha256);assert.equal(cost.apkSha256,apks[2].sha256);
const testSha=sha(await bytes(`${finish}/native-ready-world-tests.apk`));
for(const r of [capacity,crash,foreground])assert.equal(r.testApkSha256,testSha);
const old=await bytes(`${resume}/native-world-third.apk`);assert.equal(doze.apkSha256,sha(old));assert.equal(longer.apkSha256,sha(old));
await writeFile(path.join(out,'identical-native-payloads.json'),JSON.stringify({scope:'All ZIP entry contents except assets/web/ and signing metadata; no performance/visual equivalence inferred.',entries:Object.keys(apks[0].hashes).length,hashes:apks[0].hashes,apks:apks.map(({hashes,...a})=>a)},null,2),{flag:'wx'});

const stateOraclePath='apps/native-android/domain-core/build/generated/state-oracle/state-oracle.json';
const commandOraclePath='apps/native-android/domain-core/build/generated/command-oracle/command-oracle.json';
const state=await json(stateOraclePath),commands=await json(commandOraclePath);
for(const oracle of [state,commands])for(const [file,expected]of Object.entries(oracle.sourceHashes))assert.equal(sha(await bytes(file)),expected,'stale formal oracle '+file);
assert.equal(state.cases.length,996);assert.equal(state.cases.filter(c=>c.ok).length,295);assert.equal(state.holidayDates.length,500);
assert.equal(commands.cases.length,642);assert.equal(new Set(commands.cases.map(c=>c.command.type)).size,37);
await copy(stateOraclePath,'oracles/state-oracle.json');await copy(commandOraclePath,'oracles/command-oracle.json');
const jvm=[];
for(const module of ['domain-core','state-store','focus-core','world-core']){
  const dir=`apps/native-android/${module}/build/test-results/test`;let tests=0;
  for(const file of (await readdir(path.join(root,dir))).filter(f=>f.endsWith('.xml'))){
    const raw=(await bytes(`${dir}/${file}`)).toString(),head=raw.match(/<testsuite\b[^>]*>/)?.[0];assert.ok(head);
    const attrs=Object.fromEntries([...head.matchAll(/(\w+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    assert.equal(Number(attrs.failures)+Number(attrs.errors)+Number(attrs.skipped),0);tests+=Number(attrs.tests);
    await copy(`${dir}/${file}`,`jvm/${module}/${file}`);
  }
  jvm.push({module,tests,failures:0,errors:0,skipped:0});
}
assert.equal(jvm.filter(c=>c.module!=='world-core').reduce((n,c)=>n+c.tests,0),48);assert.equal(jvm.find(c=>c.module==='world-core').tests,97);
const lint=[];for(const module of ['app','world-filament']){
  const name=`apps/native-android/${module}/build/reports/lint-results-debug.txt`,raw=(await bytes(name)).toString();
  const line=raw.trim().split('\n').at(-1).trim();assert.match(line,/^0 errors,/);lint.push({module,result:line});await copy(name,`lint/${module}.txt`);
}
const tools=(await bytes(`${finish}/final-tools-audited.log`)).toString();assert.match(tools,/tests 55/);assert.match(tools,/pass 55/);assert.match(tools,/fail 0/);
for(const name of ['final-tools-audited.log','final-targeted-jvm-lint.log','native-ready-world-build.log'])await copy(`${finish}/${name}`,`logs/${name}`);

const construction=await json(`${resume}/construction-targeted-complete/p2-construction.json`);
assert.equal(construction.completed,true);assert.equal(construction.exhaustive,true);let constructionBytes=0;
for(const [fixture,input]of Object.entries(construction.fixtures)){
  assert.equal(input.rows.length,474);
  for(const row of input.rows){const raw=await bytes(`${resume}/construction-targeted-complete/${row.file}`);assert.equal(sha(raw),row.sha256);constructionBytes+=raw.length;}
  const world=await json(`artifacts/experiments/v3.0.0/p1-mc263-prepared-source-final/${fixture}.world.json`);assert.equal(world.binarySha256,input.baseBinary);
}
for(const f of construction.worldSource)assert.equal(sha(await bytes(f.path)),f.sha256,'construction producer changed');
const equality=await json(`${resume}/complete-equivalence.json`),reader=await json(`${resume}/construction-reader-first.json`);
assert.equal(equality.completed,true);assert.equal(equality.cases.length,6);assert.equal(reader.completed,true);assert.equal(reader.rows,948);
const p1=await json('artifacts/experiments/v3.0.0/p1-stage-audit-complete.json');assert.equal(p1.p1GatePassed,true);

// Formal /104 pair is intentionally not rebuilt or installed by this stage.
const standard='artifacts/verification/v2.9.0/build-104-a1863a7cddf5481fa82b1eea9a6af46d/Blockcolc-v2.9.0-verification.apk';
assert.equal(sha(await bytes(standard)),'0137898b0acbc75b222e6426d381b21e2b4475d172521af5c9032482a3e0f954');
const privatePath='C:/Codex/blockcolc-relay-private/artifacts/integrated-20261023-195643/Blockcolc-v2.9.0-private-verification.apk';
const privateSha=sha(await readFile(privatePath));assert.equal(privateSha,'c5dee73ea7dc38db81e28bdf7550dad9fa9e32115c2e842f4fc946d9a1beb52d');

async function freeze(relative){
  for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})){
    if(entry.isDirectory()){if(!['build','.gradle','.idea','node_modules','artifacts'].includes(entry.name))await freeze(`${relative}/${entry.name}`);continue;}
    if(!/\.(kt|kts|gradle|md|mjs|ts|json|html|ps1|mat|glsl|xml|txt)$/.test(entry.name)&&!['gradle.properties'].includes(entry.name))continue;
    const file=`${relative}/${entry.name}`,raw=await readFile(path.join(root,file));source.push({path:file,bytes:raw.length,sha256:sha(raw)});
    const target=path.join(out,'source',file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,raw,{flag:'wx'});
  }
}
await freeze('apps/native-android');
for(const file of ['docs/versions/3.0.0-development.md','docs/TODO.md','docs/research/3.0.0-native-migration-plan.md'])await copy(file,`source/${file}`);
const git=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const report={schema:1,kind:'p2-stage-assessment',historicalCheckpoint:true,assessedAt:new Date().toISOString(),p2FunctionalGatePassed:true,p2IntegratedNetBenefitObserved:true,p2MeasurementBoundaryPassed:false,p3Started:false,fullAppGatePassed:false,
  scope:'Representative complete-data/timer/storage/background and active-world closure under the approved P2 plan. Not a formal release gate, complete native App, universal device guarantee, or P4 startup verdict.',
  gitHead:git,dirtySourcePreserved:true,device:cost.serial,apk:apks[2].sha256,testApk:testSha,
  nativePayloadReuse:{identicalEntries:Object.keys(apks[0].hashes).length,excluded:['assets/web/','META-INF/'],scope:'Capacity/crash, foreground/background and final cost use byte-identical native code, resources and world inputs. Later local source-reference changes are retested in the final cost group.'},
  jvm,tools:{tests:55,failures:0},lint,oracles:{states:996,accepted:295,rejected:701,holidayDates:500,commandSteps:642,commandTypes:37},
  construction:{fixtures:2,thresholds:948,compressedBytes:constructionBytes,offlinePreparationMs:construction.elapsedMs,goldCases:6,scope:construction.scope},
  deviceChecks:{capacity:capacity.cases,crash:crash.recovery,foreground:{tests:5,replay:foreground.replay},background:{shortFinal:4,extendedPrevious:3,forcedDozePrevious:1,previousApk:doze.apkSha256,scope:'Extended/deep-idle evidence is explicitly from the earlier platform checkpoint, not relabelled as final-APK runs. Final native storage changes have the short matrix and byte-identical-native proof above.'},restoration:restored},
  metrics,
  decision:'Historical P2 functional/world checkpoint only. It does not close the subsequent persistence-boundary correction; use audit-p2-correction.mjs for that assessment. Not P4 performance acceptance.',
  measurementCorrections:['The legacy savedNs endpoint includes native host/platform/test work absent from the source endpoint. Its 188/195ms versus 64/69ms values are not a pure-saving regression. This historical evidence alone does not close the subsequent P2 persistence-boundary correction.'],
  remaining:['General native terrain/building generation and bounded cache invalidation, not precomputing every blueprint/progress combination.',
    'Complete modes/pages, original/MC model and weather/environment coverage, visual/UI/IME/audio/private-sync and other OEM capabilities in P3.',
    'Valid maximum-size archive memory behavior, long-term/other-device background and power measurements, final accepted v2.9.0 whole-App cache-hit/miss and startup comparison in P4.',
    'OnePlus smart optimization can still freeze callbacks; verified foreground recovery is not a promise of unrestricted background punctuality.'],
  formal104Unchanged:{standardSha256:'0137898b0acbc75b222e6426d381b21e2b4475d172521af5c9032482a3e0f954',privateSha256:privateSha},
  source,evidence};
await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({p2FunctionalGatePassed:true,p2IntegratedNetBenefitObserved:true,p3Started:false,fullAppGatePassed:false,nativePayloadEntries:Object.keys(apks[0].hashes).length,sourceFiles:source.length,jvm,output:out}));
