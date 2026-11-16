import {assertDiagnosticApk} from './native-apk-identity.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {summarizeSubmission} from './p2-submission-profile.mjs';
import {previewStorageRestored} from './p2-background-state.mjs';

const [adb,serial,apk,testApk,output]=process.argv.slice(2);
assertDiagnosticApk(apk); // Fail before any ADB command or device mutation.
if(!adb||!serial||!apk||!testApk||!output)throw Error('adb serial actual-installed.apk actual-installed-test.apk new-output');
await mkdir(output,{recursive:false});
const pkg='com.blockcolc.preview',sha=b=>createHash('sha256').update(b).digest('hex');
const call=(args,timeout=45000)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout,maxBuffer:24*1024*1024,stdio:['ignore','pipe','pipe']});
const shell=(...a)=>call(['shell',...a]).trim();
const readPrefs=()=>shell('run-as',pkg,'cat','shared_prefs/p2-storage.xml');
const instrument=method=>call(['shell','am','instrument','-w','-e','class',method,pkg+'.test/androidx.test.runner.AndroidJUnitRunner'],300000);
const result={kind:'p2-native-submission-profile',completed:false,serial,package:pkg,apkSha256:sha(await readFile(apk)),testApkSha256:sha(await readFile(testApk)),replays:[]};
let original;
try {
 for(const [target,digest] of [[pkg,result.apkSha256],[pkg+'.test',result.testApkSha256]]){
  const file=shell('pm','path',target).split('\n').find(l=>l.startsWith('package:')&&l.endsWith('/base.apk'))?.slice(8);assert.ok(file);
  assert.equal(shell('sha256sum',file).split(/\s/)[0],digest,'installed package identity');
 }
 original=readPrefs();assert.doesNotMatch(original,/name="beforeTest"/);await writeFile(path.join(output,'preferences-before.xml'),original);
 assert.equal(/deviceLocked=1/.test(shell('dumpsys','trust').split('User "system_clone"')[0]),false,'manual unlock before experiment');
 result.batteryBefore=shell('dumpsys','battery').split('\n').filter(l=>/level:|temperature:/.test(l));
 shell('am','force-stop',pkg);
 const log=instrument('com.blockcolc.preview.P2SubmissionCostTest#measureRealSubmissionPipeline');
 await writeFile(path.join(output,'instrumentation.log'),log);assert.match(log,/OK \(1 test\)/);assert.doesNotMatch(log,/FAILURES|INSTRUMENTATION_FAILED/);
 const raw=shell('run-as',pkg,'cat','files/p2-submission-cost.json');await writeFile(path.join(output,'device.json'),raw);
 const report=JSON.parse(raw),summary=summarizeSubmission(report);await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2));
 for(const group of report.cases){
  const input=path.resolve(output,'group-'+group.group+'.json'),target=path.resolve(output,'group-'+group.group+'-formal-replay.json');
  await writeFile(input,JSON.stringify(group));
  execFileSync(process.execPath,[fileURLToPath(new URL('./replay-p2-device.mjs',import.meta.url)),input,target],{encoding:'utf8',timeout:90000});
  const replay=JSON.parse(await readFile(target,'utf8'));assert.equal(replay.completed,true);result.replays.push(replay);
 }
 result.batteryAfter=shell('dumpsys','battery').split('\n').filter(l=>/level:|temperature:/.test(l));result.completed=true;
} catch(error) {
 result.failure=String(error);process.exitCode=1;
 if(error.stdout)await writeFile(path.join(output,'interrupted-stdout.log'),String(error.stdout));
 if(error.stderr)await writeFile(path.join(output,'interrupted-stderr.log'),String(error.stderr));
} finally {
 try{
  if(original&&/name="beforeTest"/.test(readPrefs())){
   const log=instrument('com.blockcolc.preview.P2BackgroundControlTest#restoreOriginalPreviewDatabase');await writeFile(path.join(output,'restore.log'),log);assert.match(log,/OK \(1 test\)/);
  }
  const after=readPrefs();await writeFile(path.join(output,'preferences-after.xml'),after);result.databaseRestored=!!original&&previewStorageRestored(original,after);assert.equal(result.databaseRestored,true);
  shell('am','force-stop',pkg);
 }catch(error){result.restoreError=String(error);result.completed=false;process.exitCode=1;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(result,null,2));
}
console.log(JSON.stringify(result));
