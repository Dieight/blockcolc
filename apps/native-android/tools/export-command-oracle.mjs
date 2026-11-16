import {buildSync} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{console.error(String(error.stack??error).split('\n').filter(s=>s.length<1200).join('\n'));process.exit(1);});
const root=fileURLToPath(new URL('../../../',import.meta.url));
const code=buildSync({entryPoints:[path.join(root,'packages/domain/src/index.ts')],bundle:true,write:false,platform:'node',format:'esm'}).outputFiles[0].text;
const {createInitialState,execute,parseDomainState,holidaysForYear}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const projectionCode=buildSync({entryPoints:[path.join(root,'packages/application/src/focus-attribution.ts')],bundle:true,write:false,platform:'node',format:'esm'}).outputFiles[0].text;
const {projectFocusAttribution}=await import('data:text/javascript;base64,'+Buffer.from(projectionCode).toString('base64'));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const cases=[];let state,now,label;
const epoch=Date.parse('2026-10-01T08:00:00.000Z');
function begin(name,tz='UTC',at=epoch){label=name;state=createInitialState(tz);now=at;}
function step(command,delta=0){now+=delta;const before=structuredClone(state);const r=execute(state,command,{now:()=>new Date(now)});if(r.ok)state=r.state;
  try{parseDomainState(state);}catch(error){throw Error(`${label}/${command.type}: formal executor produced non-persistable state: ${error}`);}
  cases.push({name:label+':'+cases.length,now,command,before,ok:r.ok,error:r.ok?null:r.code,canonical:canonical(state),events:r.ok?canonical(r.events):'[]',attribution:canonical(projectFocusAttribution(state))});return r;
}
const create=(id='host',tasks=['read','write'])=>({type:'CreateProject',projectId:id,title:'任务 '+id,blueprintId:'cottage',subtasks:tasks.map(id=>({id,title:'小任务 '+id}))});
const start=(id,duration=60000,projectId='host',deferred=true,task=null)=>({type:'StartFocus',sessionId:id,projectId,subtaskId:task,plannedDurationMs:duration,...(deferred?{marathon:true,deferredSettlement:true}:{})});
const target=(id,task='read',progress=5000,rounds=1,projectId='host')=>({reportId:id,projectId,subtaskId:task,progressBasisPoints:progress,...(rounds===null?{}:{rounds})});
const report=(ids,entries=[],habitAllocations=[])=>({type:'ReportMarathonFocus',focusSessionIds:ids,entries,habitAllocations});
function seed(name,tz='UTC',at=epoch){begin(name,tz,at);step(create());step(create('other',['build']));step({type:'CreateHabitProject',projectId:'habit',title:'习惯',blueprintId:'cottage',targetRounds:10});step({type:'SwitchActiveProject',projectId:'host'});}
seed('task-crud');
for(const cmd of [{type:'AddQuickNote',noteId:'note',text:' 中间中文 😀 '},{type:'SetQuickNoteCompleted',noteId:'note',completed:true},{type:'RenameQuickNote',noteId:'note',text:'已改'},
{type:'DeleteQuickNote',noteId:'note'},{type:'DeleteQuickNote',noteId:'note'},{type:'RenameProject',title:' 新标题 '},{type:'AddSubtask',subtaskId:'third',title:' 第三件事 '},
{type:'RenameSubtask',subtaskId:'third',title:'新子项'},{type:'ReorderSubtasks',orderedSubtaskIds:['third','write','read']},{type:'RemoveSubtask',subtaskId:'third'},
{type:'AddSubtask',subtaskId:'third',title:'不能复用旧 ID'},{type:'RemoveSubtask',subtaskId:'missing'},{type:'SwitchActiveProject',projectId:'missing'},
{type:'CreateHabitProject',projectId:'habit',title:'重复',blueprintId:'cottage',targetRounds:10}])step(cmd);
for(const style of ['natural-valley','classic-island','ocean-island','mosaic-coast','mosaic-coast','bad'])step({type:'ConfigureWorldEnvironment',environmentStyle:style});
for(const cmd of [{type:'ConfigureCalendar',timeZone:'Asia/Shanghai',restWeekdays:[6,0]},{type:'ConfigureCalendar',timeZone:'UTC',restWeekdays:[0,0]},{type:'ConfigureCalendar',timeZone:'bad',restWeekdays:[]},
{type:'DeleteActiveProject',projectId:'other'},{type:'DeleteActiveProject',projectId:'host'},{type:'SwitchActiveProject',projectId:'host'},{type:'SwitchActiveProject',projectId:'other'}])step(cmd);
seed('regular');step(start('one',60000,'host',false,'read'));step(create('blocked',['x']));step({type:'SwitchActiveProject',projectId:'other'});step({type:'DeleteActiveProject',projectId:'host'});
step({type:'CompleteFocus'},59999);step({type:'CompleteFocus'},1);step({type:'SwitchActiveProject',projectId:'other'});
for(const cmd of [{type:'ReportSubtaskProgress',reportId:'r',subtaskId:'read',focusSessionIds:['one'],progressBasisPoints:5000},{type:'ReportSubtaskProgress',reportId:'r',subtaskId:'read',focusSessionIds:['one'],progressBasisPoints:5000},
{type:'ReportSubtaskProgress',reportId:'r2',subtaskId:'read',focusSessionIds:['one'],progressBasisPoints:6000},{type:'AddSubtask',subtaskId:'locked',title:'锁定'},
{type:'ReorderSubtasks',orderedSubtaskIds:['write','read']},{type:'RenameSubtask',subtaskId:'read',title:'可改名'}])step(cmd,1);
step(start('two',60000,'host',false,'read'),1);step({type:'CompleteFocusEarly',reportId:'early-read'},1000);step(start('three',60000,'host',false,'write'),1);step({type:'CompleteFocusEarly',reportId:'early-write'},1000);
step({type:'SwitchActiveProject',projectId:'host'});step(start('after-seal',1000,'host',false,'read'));
seed('deferred');step(start('one'));step({type:'CompleteFocus'},60000);step(start('two',30000),1000);step({type:'CompleteFocus'},30000);step(start('three'),1000);step({type:'CompleteFocusEarly',reportId:'unused'},10000);
step(report(['three','one','two'],[target('p')],[{projectId:'habit',rounds:1}]));step(report(['one'],[target('replay','write')]));
for(const [name,entries,habits] of [
['zero',[target('r','read',5000,0)],[]],['overflow',[target('r','read',5000,2)],[]],['mixed',[target('r'),target('q','write',4000,null)],[]],
['duplicate-task',[target('r'),target('q')],[]],['duplicate-report',[target('r'),target('r','write')],[]],['missing-task',[target('r','missing')],[]],
['habit-overflow',[],[{projectId:'habit',rounds:2}]],['habit-zero',[],[{projectId:'habit',rounds:0}]],['missing-habit',[],[{projectId:'missing',rounds:1}]],
['habit-plus-entry',[target('r')],[{projectId:'habit',rounds:1}]],['discard',[],[]],['legacy-shared',[target('r','read',5000,null),target('q','write',3000,null)],[]]]){
  seed('allocation-'+name);step(start('one',1000));step({type:'CompleteFocus'},1000);step(report(['one'],entries,habits));step(report(['one'],[target('late')]));
}
seed('seal-while-active');step(start('one',1000));step({type:'CompleteFocus'},1000);step(start('two',1000),1);step(report(['one'],[target('r','build',10000,1,'other')]));step({type:'CompleteFocus'},1000);step(report(['one','two'],[target('r','build',10000,1,'other')]));
for(const deferred of [false,true]){
  seed('habit-'+deferred);step({type:'SwitchActiveProject',projectId:'habit'});for(let i=0;i<10;i++){step(start('h'+i,1000,'habit',deferred),1);step(i===9?{type:'CompleteFocusEarly',reportId:'unused'}:{type:'CompleteFocus'},i===9?500:1000);}
  if(deferred)step(report(Array.from({length:10},(_,i)=>'h'+i),[],[{projectId:'habit',rounds:10}]));
  step({type:'SwitchActiveProject',projectId:'habit'});step({type:'SelectNextHabitBuilding',blueprintId:'tower',targetRounds:12});step(start('next',1000,'habit',false),1);step({type:'CompleteFocus'},1000);
}
for(const mode of ['early','cancel']){
  seed('manual-'+mode);step(start('manual'));step(mode==='early'?{type:'CompleteFocusEarly',reportId:'early'}:{type:'CancelFocus',interruptionCategory:'other',interruptionNote:' 简短原因 '},1000);step(report(['manual']));
}
seed('integrity');step({type:'ConfigureFocusIntegrity',enabled:true,maxEffectiveExcursions:2,excursionThresholdSeconds:3});step(start('one',600000,'host',false,'read'));
for(const [reason,delta]of [['screen-lock',5000],['app-switch',3000],['app-switch',3001],['app-switch',3001]]){step({type:'RecordFocusBackgrounded',reason},1);step({type:'RecordFocusForegrounded'},delta);}
step({type:'GrantFocusLifecycleExemption'});step(start('two',600000,'host',false,'read'));step({type:'GrantFocusLifecycleExemption'});step({type:'RecordFocusBackgrounded',reason:'app-switch'},1);step({type:'RecordFocusBackgrounded',reason:'app-switch'},1);step({type:'RecordFocusForegrounded'},6000);step({type:'CancelFocus'});
seed('deadline');step({...start('short'),deadlineAt:new Date(now+1234).toISOString()});step({type:'CompleteFocus'},1233);step({type:'RecordFocusForegrounded'},1);
for(const duration of [0,-1,0.5])step(start('invalid-'+duration,duration));step({...start('expired'),deadlineAt:new Date(now).toISOString()});
seed('decay');step({type:'EnableDecay',damagePerMissedPlannedDayBasisPoints:1000,gracePlannedDays:1});step({type:'AssessDecay'},14*86400000);step(start('repair',1000,'host',false,'read'));step({type:'CompleteFocus'},1000);step({type:'ReportSubtaskProgress',reportId:'r',subtaskId:'read',focusSessionIds:['repair'],progressBasisPoints:0});
step({type:'ConfigureCalendar',timeZone:'Europe/Berlin',restWeekdays:[]});step({type:'AssessDecay'},2*86400000);step({type:'DisableDecay'});step({type:'AssessDecay'});
const states=JSON.parse(readFileSync(path.join(root,'apps/native-android/domain-core/build/generated/state-oracle/state-oracle.json'),'utf8')).states;
const bp=states.project.projects[0].importedBlueprint;
seed('resources');step({type:'ImportBuildingBlueprint',blueprint:bp});step({type:'ImportBuildingBlueprint',blueprint:bp});step({type:'RenameBuildingBlueprint',blueprintId:bp.id,displayName:' 新名字 '});step({type:'ImportDecorationBlueprint',blueprint:{...bp,id:'reward'}});
const stripped=structuredClone(bp);stripped.id='enrich';for(const v of stripped.voxels){delete v.sourceBlockState;delete v.sign;delete v.campfire;}
step({type:'ImportBuildingBlueprint',blueprint:stripped});step({type:'ImportBuildingBlueprint',blueprint:{...bp,id:'enrich'}});step({type:'ImportBuildingBlueprint',blueprint:stripped});step({type:'DeleteBuildingBlueprint',blueprintId:bp.id});step({type:'DeleteBuildingBlueprint',blueprintId:bp.id});
for(let i=0;i<37;i++)step({type:'ImportBuildingBlueprint',blueprint:{...bp,id:'library-'+i}});
for(const h of holidaysForYear(2026)){
  seed('reward-'+h.id,'Asia/Shanghai',Date.parse(h.date+'T08:00:00.000Z'));step({type:'ConfigureBirthday',enabled:true,month:Number(h.date.slice(5,7)),day:Number(h.date.slice(8))});step({type:'ObserveBirthday'});step({type:'ObserveBirthday'});
  step({type:'ImportDecorationBlueprint',blueprint:{...bp,id:'reward'}});step({type:'SetDailyGoal',date:h.date,targetPomodoros:1});step(start('reward',1000,'host',false,'read'));step({type:'CompleteFocus'},1000);step({type:'DisableDailyGoal',date:h.date});step({type:'SetDailyGoal',date:h.date,targetPomodoros:2});
}
for(const tz of ['America/New_York','Europe/Berlin','Asia/Shanghai','Pacific/Apia','EST','ROC','+23:59']){
  seed('timezone-'+tz,tz,Date.parse('2026-11-01T05:59:59.999Z'));step(start('tz',2,'host',false,'read'));step({type:'CompleteFocus'},2);
}
const sourceHashes={};for(const file of readdirSync(path.join(root,'packages/domain/src')).filter(f=>f.endsWith('.ts'))){const name='packages/domain/src/'+file;sourceHashes[name]=createHash('sha256').update(readFileSync(path.join(root,name))).digest('hex');}
sourceHashes['apps/native-android/tools/export-command-oracle.mjs']=createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
sourceHashes['packages/application/src/focus-attribution.ts']=createHash('sha256').update(readFileSync(path.join(root,'packages/application/src/focus-attribution.ts'))).digest('hex');
const out=process.argv[2];assert(out);mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'command-oracle.json'),JSON.stringify({schema:1,sourceHashes,cases,commandTypes:[...new Set(cases.map(c=>c.command.type))].sort()}));
console.log(JSON.stringify({steps:cases.length,types:[...new Set(cases.map(c=>c.command.type))].length,accepted:cases.filter(c=>c.ok).length}));
