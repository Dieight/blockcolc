import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {previewStorageRestored} from './p2-background-state.mjs';
const [adb,serial,apk,testApk,output]=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
if(!adb||!serial||!apk||!testApk||!output)throw Error('adb serial installed-preview.apk installed-tests.apk new-output');
const pkg='com.blockcolc.preview',sha=b=>createHash('sha256').update(b).digest('hex');
const call=(args,timeout=45000)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout,maxBuffer:2*1024*1024});
const shell=(...args)=>call(['shell',...args]).trim(),prefs=()=>shell('run-as',pkg,'cat','shared_prefs/p2-storage.xml');
await mkdir(output,{recursive:false});
const result={kind:'p2-android-capacity-atomicity',completed:false,serial,package:pkg,apkSha256:sha(await readFile(apk)),testApkSha256:sha(await readFile(testApk)),restored:{database:false},
 scope:'Real >10MiB payload round-trip, SQLite merged root/rollback, 100MiB+1 wire rejection, 512MiB reference amplification rejection and duplicate/stale deadline on Android. Not a claim that a valid 100MiB/512MiB archive fits every device heap.'};
let original;
try{
 for(const [id,expected]of[[pkg,result.apkSha256],[pkg+'.test',result.testApkSha256]]){
  const base=shell('pm','path',id).split('\n').find(l=>l.startsWith('package:')&&l.endsWith('/base.apk'))?.slice(8);assert.ok(base);
  assert.equal(shell('sha256sum',base).split(/\s/)[0],expected,'installed APK identity');
 }
 original=prefs();assert.doesNotMatch(original,/name="beforeTest"/);await writeFile(path.join(output,'preferences-before.xml'),original);
 let log;
 try{log=call(['shell','am','instrument','-w','-e','class','com.blockcolc.preview.P2CapacityTest',pkg+'.test/androidx.test.runner.AndroidJUnitRunner'],360000);}
 catch(error){
  // Preserve the runner's partial result on host timeout as well as its final
  // error. Otherwise an OEM-frozen runner looks like an unexplained long test.
  await writeFile(path.join(output,'instrumentation-interrupted.log'),String(error.stdout??'')+String(error.stderr??''));throw error;
 }
 await writeFile(path.join(output,'instrumentation.log'),log);assert.match(log,/OK \(4 tests\)/);assert.doesNotMatch(log,/FAILURES|INSTRUMENTATION_FAILED/);
 result.cases=[];
 for(const name of['capacity','capacity-limits','device-idempotence','large-row-reader']){
  const data=JSON.parse(shell('run-as',pkg,'cat','files/p2-'+name+'.json'));await writeFile(path.join(output,name+'.json'),JSON.stringify(data,null,2));
  assert.equal(data.completed,true);result.cases.push({name,...data});
 }
 result.completed=true;
}catch(error){result.failure=String(error);process.exitCode=1;}
finally{
 try{const after=prefs();await writeFile(path.join(output,'preferences-after.xml'),after);result.restored.database=Boolean(original)&&previewStorageRestored(original,after);assert.equal(result.restored.database,true);shell('am','force-stop',pkg);}
 catch(error){result.restoreError=String(error);result.completed=false;process.exitCode=1;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(result,null,2));
}
console.log(JSON.stringify(result));
