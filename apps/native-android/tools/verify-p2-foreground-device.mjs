import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {previewStorageRestored} from './p2-background-state.mjs';

const [adb,serial,apk,testApk,output]=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
if(!adb||!serial||!apk||!testApk||!output)throw Error('adb serial exact-installed-preview.apk exact-installed-tests.apk new-output required');
const pkg='com.blockcolc.preview',runner=pkg+'.test/androidx.test.runner.AndroidJUnitRunner';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const call=(args,timeout=45000,encoding='utf8')=>execFileSync(adb,['-s',serial,...args],{encoding,timeout,maxBuffer:12*1024*1024});
const shell=(...args)=>call(['shell',...args]).trim();
const preferences=()=>shell('run-as',pkg,'cat','shared_prefs/p2-storage.xml');
await mkdir(output,{recursive:false});
const result={kind:'p2-real-foreground-storage-and-world-flow',completed:false,serial,package:pkg,executedAt:new Date().toISOString(),
  apkSha256:hash(await readFile(apk)),testApkSha256:hash(await readFile(testApk)),restored:{database:false},
  scope:'Five Android storage/host checks, including the actual rendered 25-building world, UI start/report, committed facts, owner update and stats. Not full P2 or performance acceptance.'};
let before;
try {
  for(const [id,expected]of [[pkg,result.apkSha256],[pkg+'.test',result.testApkSha256]]){
    const base=shell('pm','path',id).split('\n').find(line=>line.startsWith('package:')&&line.endsWith('/base.apk'))?.slice(8);
    assert.ok(base);assert.equal(shell('sha256sum',base).split(/\s/)[0],expected,'installed identity '+id);
  }
  before=preferences();assert.doesNotMatch(before,/name="beforeTest"/);
  await writeFile(path.join(output,'preferences-before.xml'),before);
  const log=call(['shell','am','instrument','-w','-e','class','com.blockcolc.preview.P2DeviceTest',runner],210000);
  await writeFile(path.join(output,'instrumentation.log'),log);
  assert.match(log,/OK \(5 tests\)/);assert.doesNotMatch(log,/FAILURES|INSTRUMENTATION_FAILED/);
  for(const name of ['p2-foreground-flow.json','p2-android-null-contract.json','p2-construction-ocean.json','p2-flow-statistics.png']){
    const bytes=call(['exec-out','run-as',pkg,'cat','files/'+name],45000,null);
    await writeFile(path.join(output,name),bytes);
  }
  const flow=JSON.parse(await readFile(path.join(output,'p2-foreground-flow.json')));
  assert.equal(flow.completed,true);assert.ok(flow.world.updatedFrameSubmittedNs>0);
  const replay=execFileSync(process.execPath,[fileURLToPath(new URL('./replay-p2-device.mjs',import.meta.url)),
    path.resolve(output,'p2-foreground-flow.json'),path.resolve(output,'formal-replay.json')],{encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
  result.replay=JSON.parse(replay.trim());assert.equal(result.replay.completed,true);
  result.completed=true;result.tests=5;
}catch(error){
  result.failure=String(error);process.exitCode=1;
  for(const name of ['p2-foreground-flow.json','p2-flow-failure.xml','p2-flow-failure.png']){
    try{await writeFile(path.join(output,name),call(['exec-out','run-as',pkg,'cat','files/'+name],45000,null));}catch{}
  }
}finally{
  try{
    if(before&&/name="beforeTest"/.test(preferences())){
      const log=call(['shell','am','instrument','-w','-e','class','com.blockcolc.preview.P2BackgroundControlTest#restoreOriginalPreviewDatabase',runner],60000);
      await writeFile(path.join(output,'restore.log'),log);assert.match(log,/OK \(1 test\)/);
    }
    const after=preferences();await writeFile(path.join(output,'preferences-after.xml'),after);
    result.restored.database=Boolean(before)&&previewStorageRestored(before,after);assert.equal(result.restored.database,true);
    shell('am','force-stop',pkg);shell('input','keyevent','3');
  }catch(error){result.restoreError=String(error);result.completed=false;process.exitCode=1;}
  await writeFile(path.join(output,'report.json'),JSON.stringify(result,null,2));
}
console.log(JSON.stringify(result));
