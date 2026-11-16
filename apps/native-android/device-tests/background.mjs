import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const [adb,serial,apk,output,...requested]=process.argv.slice(2);
if(!adb||!serial||!apk||!output)throw Error('adb serial installed-preview-apk fresh-output [case...] required');
const names=requested.length?requested:['home','process-death','auto-off','notifications-denied','exact-denied','force-stop','screen-off','deep-idle'];
if(names.some(n=>!['home','process-death','auto-off','notifications-denied','exact-denied','force-stop','screen-off','deep-idle','long-plan'].includes(n)))throw Error('Unknown case');
const pkg='com.blockcolc.preview',runner=pkg+'.test/androidx.test.runner.AndroidJUnitRunner';
const call=args=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024}).trim();
const shell=(...args)=>call(['shell',...args]);const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
const permission=()=>/android\.permission\.POST_NOTIFICATIONS: granted=true/.test(shell('dumpsys','package',pkg));
function mode(op){const text=shell('cmd','appops','get',pkg,op);return text.match(new RegExp(op+': (allow|ignore|deny|default|foreground)'))?.[1]??'default';}
function setOp(op,value){shell('cmd','appops','set',pkg,op,value);}
const policy={};
function setPermission(kind,desired){
 if(desired!==null&&policy[kind]===desired)return;
 const text=execFileSync('pwsh',['-NoLogo','-NoProfile','-File',new URL('./set-permission.ps1',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),'-Kind',kind,'-Mode',desired===null?'read':desired?'enabled':'disabled','-Serial',serial],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
 const value=JSON.parse(text.trim());if(value.package!==pkg)throw Error('Permission tool targeted another app');policy[kind]=value.current;return value;
}
const focus=()=>shell('dumpsys','window').split('\n').find(l=>l.includes('mCurrentFocus='))??'';
function live(){return JSON.parse(shell('run-as',pkg,'cat','files/p2-live.json'));}
async function instrument(method,args,label){const text=call(['shell','am','instrument','-w','-r','-e','class','com.blockcolc.preview.P2BackgroundControlTest#'+method,...Object.entries(args).flatMap(([k,v])=>['-e',k,String(v)]),runner]);await writeFile(path.join(output,label+'.log'),text);if(!/OK \(1 test\)/.test(text)||/FAILURES!!!|Process crashed/.test(text))throw Error('Instrumentation failed: '+label);}
await mkdir(output,{recursive:false});
const report={kind:'p2-real-android-background',package:pkg,serial,executedAt:new Date().toISOString(),cases:[],completed:false};
let original,prepared=false,forcedIdle=false;
try{
 if(!focus().includes('com.android.launcher')&&!focus().includes(pkg))throw Error('Phone is busy; no external app closed');
 const base=shell('pm','path',pkg).split('\n').find(s=>s.startsWith('package:')&&s.endsWith('/base.apk'))?.slice(8);
 report.apkSha256=createHash('sha256').update(await readFile(apk)).digest('hex');
 if(!base?.startsWith('/data/app/')||shell('sha256sum',base).split(/\s/)[0]!==report.apkSha256)throw Error('Installed preview differs');
 original={notifications:permission(),notificationMode:mode('POST_NOTIFICATION'),exactMode:mode('SCHEDULE_EXACT_ALARM')};
 original.alarms=setPermission('alarms',null).current;setPermission('notifications',null);report.original=original;
 await writeFile(path.join(output,'preflight.json'),JSON.stringify(report,null,2));
 for(const name of names){
   if(!focus().includes('com.android.launcher')&&!focus().includes(pkg))throw Error('Phone became busy');
   setPermission('notifications',name!=='notifications-denied');setPermission('alarms',name!=='exact-denied');
   const row={name,scope:name==='long-plan'?'Real 25-minute focus, 5-minute rest and 2-minute final focus':'Short boundary contract, not long-duration or OEM visual certification'};report.cases.push(row);
   const args={case:name,auto:name==='auto-off'?'false':'true'};
   if(name==='long-plan')Object.assign(args,{focusMs:1500000,restMs:300000,rounds:2,endDurationMs:1920000});
   await instrument('prepare',args,name+'-prepare');prepared=true;
   const initial=JSON.parse(shell('run-as',pkg,'cat','files/p2-prepared-'+name+'.json'));row.prepared=initial;
   await writeFile(path.join(output,name+'-prepared.json'),JSON.stringify(initial));
   shell('am','start','-W','-n',pkg+'/.MainActivity','--ez','business','true','--ez','skipWorld','true');
   if(!focus().includes(pkg))throw Error('Preview did not gain foreground');
   shell('input','keyevent','KEYCODE_HOME');
   if(name==='process-death'){
     const pid=shell('pidof',pkg);if(!/^\d+$/.test(pid))throw Error('Ambiguous owned PID');
     if(shell('run-as',pkg,'cat','/proc/'+pid+'/cmdline').replaceAll('\0','')!==pkg)throw Error('PID ownership differs');
     row.killedPid=pid;shell('run-as',pkg,'kill','-9',pid);
   }
   if(name==='force-stop')shell('am','force-stop',pkg);
   if(name==='screen-off'||name==='deep-idle'){shell('input','keyevent','KEYCODE_SLEEP');}
   if(name==='deep-idle'){row.idleBefore=shell('cmd','deviceidle','get','deep');row.forceIdle=shell('cmd','deviceidle','force-idle');forcedIdle=true;}
   const end=initial.exactEndAt?Date.parse(initial.exactEndAt):Date.parse(initial.startedAt)+initial.rounds*initial.focusMs+(initial.rounds-1)*initial.restMs;
   const deviceNow=Number(shell('date','+%s%3N'));await sleep(end-deviceNow+3500);
   row.beforeResume=live();await writeFile(path.join(output,name+'-before-resume.json'),JSON.stringify(row.beforeResume));
   if(row.beforeResume.database!==initial.database)throw Error('Stale live file');
   row.independent=row.beforeResume.phase===(name==='auto-off'?'READY':'REPORT');
   if(row.beforeResume.notices.some(n=>n.overdueCountdown))throw Error('Observed expired live countdown');
   if(forcedIdle){row.unforce=shell('cmd','deviceidle','unforce');forcedIdle=false;}
   shell('input','keyevent','KEYCODE_WAKEUP');
   const size=shell('wm','size').match(/(\d+)x(\d+)/);if(!size)throw Error('Display size unavailable');
   if(/showing=true|isStatusBarKeyguard=true/.test(shell('dumpsys','window','policy')))shell('input','swipe',String(Math.round(Number(size[1])*.5)),String(Math.round(Number(size[2])*.85)),String(Math.round(Number(size[1])*.5)),String(Math.round(Number(size[2])*.25)),'350');
   if(/showing=true|isStatusBarKeyguard=true/.test(shell('dumpsys','window','policy')))throw Error('Manual unlock required; permissions/database restoration will still be attempted');
   shell('am','start','-W','-n',pkg+'/.MainActivity','--ez','business','true','--ez','skipWorld','true');
   await sleep(1800);row.afterResume=live();
   await writeFile(path.join(output,name+'-after-resume.json'),JSON.stringify(row.afterResume));
   const old=new Set(JSON.parse(initial.initial).focusHistory.map(f=>f.id));const history=row.afterResume.domain.focusHistory.filter(f=>!old.has(f.id));
   const expected=name==='auto-off'?1:initial.rounds;
   if(history.length!==expected||history.some(f=>f.status!=='completed'))throw Error('Incomplete recovered timeline: '+name);
   for(let i=0;i<history.length;i++){
     const at=Date.parse(initial.startedAt)+i*(initial.focusMs+initial.restMs),duration=initial.exactEndAt?Math.min(initial.focusMs,Date.parse(initial.exactEndAt)-at):initial.focusMs;
     if(Date.parse(history[i].startedAt)!==at||history[i].actualDurationMs!==duration||Date.parse(history[i].completedAt)!==at+duration)throw Error('Absolute schedule changed: '+name);
   }
   if(row.afterResume.domain.decorationRewards.filter(r=>r.resourceId==='p2-reward').length!==1||row.afterResume.domain.birthdayRewards.length!==1)throw Error('Reward missing or repeated');
   if(name==='auto-off'&&row.afterResume.localRecovery.automatic!==null)throw Error('Manual wait acquired an automatic grant');
   row.verified=true;
   shell('input','keyevent','KEYCODE_HOME');await instrument('restoreOriginalPreviewDatabase',{},name+'-restore');prepared=false;
 }
 report.completed=true;
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{
 try{if(forcedIdle)shell('cmd','deviceidle','unforce');}catch(error){report.idleRestoreError=String(error);}
 if(prepared)try{await instrument('restoreOriginalPreviewDatabase',{},'interrupted-restore');prepared=false;}catch(error){report.databaseRestoreError=String(error);}
 if(original)try{
   setPermission('notifications',original.notifications);setPermission('alarms',original.alarms);
   report.restored={notifications:permission()===original.notifications,alarms:policy.alarms===original.alarms,database:!prepared};
   report.finalModes={notifications:mode('POST_NOTIFICATION'),alarms:mode('SCHEDULE_EXACT_ALARM')};
   if(Object.values(report.restored).some(v=>v!==true))throw Error('Restoration mismatch');
 }catch(error){report.restoreError=String(error);process.exitCode=1;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({completed:report.completed,failure:report.failure,cases:report.cases.map(c=>({name:c.name,independent:c.independent,verified:c.verified})),restored:report.restored}));
}
