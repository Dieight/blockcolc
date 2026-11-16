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
const call=(args,timeout=45000)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});
const shell=(...args)=>call(['shell',...args]).trim(),prefs=()=>shell('run-as',pkg,'cat','shared_prefs/p2-storage.xml');
await mkdir(output,{recursive:false});
const result={kind:'p2-real-sqlite-process-death',completed:false,serial,package:pkg,apkSha256:sha(await readFile(apk)),testApkSha256:sha(await readFile(testApk)),restored:{database:false},
 scope:'Kills only its own preview test process after actual row/metadata/rollback-root writes but before SQLite COMMIT; then opens from a different PID, verifies prior state and retries the same request exactly once. Intentional crash is not counted as a passing JUnit invocation.'};
let original;
async function run(method,crash=false){
 const log=call(['shell','am','instrument','-w','-e','class','com.blockcolc.preview.P2CrashControlTest#'+method,pkg+'.test/androidx.test.runner.AndroidJUnitRunner'],90000);
 await writeFile(path.join(output,method+'.log'),log);
 if(crash)assert.match(log,/Process crashed|process crashed/);
 else{assert.match(log,/OK \(1 test\)/);assert.doesNotMatch(log,/FAILURES|INSTRUMENTATION_FAILED/);}
}
try{
 for(const [id,expected]of[[pkg,result.apkSha256],[pkg+'.test',result.testApkSha256]]){
  const base=shell('pm','path',id).split('\n').find(l=>l.startsWith('package:')&&l.endsWith('/base.apk'))?.slice(8);assert.ok(base);
  assert.equal(shell('sha256sum',base).split(/\s/)[0],expected);
 }
 original=prefs();assert.doesNotMatch(original,/name="beforeTest"/);await writeFile(path.join(output,'preferences-before.xml'),original);
 await run('prepare');const control=JSON.parse(shell('run-as',pkg,'cat','files/p2-crash-control.json'));
 await run('dieBeforeTransactionCommit',true);const marker=JSON.parse(shell('run-as',pkg,'cat','files/p2-crash-marker.json'));
 assert.equal(marker.database,control.database);assert.equal(marker.preparedAt,control.preparedAt);assert.equal(marker.checkpoint,'before-commit');
 let pid='';try{pid=shell('pidof',pkg);}catch{}assert.equal(pid.split(/\s/).includes(String(marker.pid)),false,'marked writer actually died');
 await writeFile(path.join(output,'marker.json'),JSON.stringify(marker,null,2));
 await run('verifyCrashRecoveryAndSameRequestRetry');result.recovery=JSON.parse(shell('run-as',pkg,'cat','files/p2-crash-recovery.json'));
 assert.equal(result.recovery.completed,true);assert.notEqual(result.recovery.recoveryPid,marker.pid);result.completed=true;
}catch(error){result.failure=String(error);process.exitCode=1;}
finally{
 try{const after=prefs();await writeFile(path.join(output,'preferences-after.xml'),after);result.restored.database=Boolean(original)&&previewStorageRestored(original,after);assert.equal(result.restored.database,true);shell('am','force-stop',pkg);}
 catch(error){result.restoreError=String(error);result.completed=false;process.exitCode=1;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(result,null,2));
}
console.log(JSON.stringify(result));
