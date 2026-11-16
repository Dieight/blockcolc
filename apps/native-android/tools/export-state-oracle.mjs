import {buildSync} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

process.on('uncaughtException',error=>{console.error(String(error.stack??error).split('\n').filter(line=>line.length<1200).join('\n'));process.exit(1);});

const root=fileURLToPath(new URL('../../../',import.meta.url));
const code=buildSync({entryPoints:[path.join(root,'packages/domain/src/index.ts')],bundle:true,write:false,platform:'node',format:'esm'}).outputFiles[0].text;
const {createInitialState,execute,parseDomainState,holidaysForYear}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const cases=[],states={};
function add(name,input){
  try{const out=parseDomainState(input);cases.push({name,input,ok:true,canonical:canonical(out)});return out;}
  catch(e){cases.push({name,input,ok:false,code:e.code??e.name,path:e.path??null});return null;}
}
function save(name,state){assert(add(name,structuredClone(state)),`Invalid formal state: ${name}`);states[name]=structuredClone(state);return state;}
const epoch=Date.parse('2026-10-01T08:00:00.000Z');
let state=createInitialState('Asia/Shanghai');
save('empty',state);
let tick=epoch;
function step(name,cmd,offset=0){tick+=offset;const r=execute(state,cmd,{now:()=>new Date(tick)});assert(r.ok,r.ok?'':`${name}: ${r.code} ${r.message}`);state=r.state;save(name,state);}
const sign={front:{lines:['方块钟','A😀B'],dyeColor:'cyan',glowing:true},back:{lines:[],dyeColor:'black',glowing:false}};
const blueprint={schemaVersion:1,id:'imported',title:'完整蓝图',bounds:{minX:0,maxX:3,minY:0,maxY:0,minZ:0,maxZ:0},voxels:[
  {x:0,y:0,z:0,materialId:'wood',stage:'details',buildOrder:8000,sourceBlockId:'minecraft:oak_sign',sourceBlockState:{rotation:'4',waterlogged:'false'},sign},
  {x:1,y:0,z:0,materialId:'stone',stage:'foundation',buildOrder:0,sourceBlockId:'minecraft:campfire',campfire:{slots:[{slot:3,itemId:'minecraft:potato',count:2},{slot:0,itemId:'minecraft:cod',count:1}]},emissiveKind:'fire',emissiveLevel:12},
  {x:2,y:0,z:0,materialId:'accent',stage:'frame',buildOrder:123,sourceBlockId:'minecraft:moving_piston',movingPistonMovedState:{blockId:'minecraft:red_wool',properties:{axis:'y'}},movingPistonPose:{facing:'east',progress:0.3,extending:true,source:false}},
  {x:3,y:0,z:0,materialId:'glass',stage:'walls',buildOrder:4500,sourceBlockId:'minecraft:glass',sourceBlockState:{}},
]};
step('resource',{type:'ImportBuildingBlueprint',blueprint});
step('project',{type:'CreateProject',projectId:'host',title:'主任务',blueprintId:blueprint.id,importedBlueprint:blueprint,subtasks:[{id:'read',title:'阅读'},{id:'write',title:'写作'}]});
step('habit',{type:'CreateHabitProject',projectId:'habit',title:'散步',blueprintId:'cottage',targetRounds:10});
step('host-selected',{type:'SwitchActiveProject',projectId:'host'});
step('notes',{type:'AddQuickNote',noteId:'note',text:'在中间插入中文 😀'});
step('birthday-configured',{type:'ConfigureBirthday',enabled:true,month:10,day:1});
step('birthday-reward',{type:'ObserveBirthday'});
step('decoration-resource',{type:'ImportDecorationBlueprint',blueprint:{...structuredClone(blueprint),id:'reward'}});
step('goal',{type:'SetDailyGoal',date:'2026-10-01',targetPomodoros:1});
step('active',{type:'StartFocus',sessionId:'s1',subtaskId:'read',plannedDurationMs:60000});
step('background',{type:'RecordFocusBackgrounded',reason:'app-switch'},1000);
step('foreground',{type:'RecordFocusForegrounded'},1000);
step('complete',{type:'CompleteFocus'},58000);
step('reported',{type:'ReportSubtaskProgress',reportId:'r1',subtaskId:'read',focusSessionIds:['s1'],progressBasisPoints:5000});
step('deferred-active',{type:'StartFocus',sessionId:'s2',projectId:'host',subtaskId:null,plannedDurationMs:60000,marathon:true,deferredSettlement:true},1000);
step('deferred-complete',{type:'CompleteFocus'},60000);
step('allocation',{type:'ReportMarathonFocus',focusSessionIds:['s2'],entries:[{reportId:'r2',projectId:'host',subtaskId:'write',progressBasisPoints:1000,rounds:1}],habitAllocations:[]});
step('interrupt-active',{type:'StartFocus',sessionId:'s3',subtaskId:'write',plannedDurationMs:60000},1000);
step('interrupted',{type:'CancelFocus',interruptionCategory:'other',interruptionNote:' 理由 '},1000);
step('decay',{type:'EnableDecay',damagePerMissedPlannedDayBasisPoints:100,gracePlannedDays:2});
const rich=structuredClone(state);
step('habit-selected',{type:'SwitchActiveProject',projectId:'habit'});
for(let i=0;i<10;i++){
  step(`habit-active-${i}`,{type:'StartFocus',sessionId:`habit-${i}`,subtaskId:null,plannedDurationMs:1000},1000);
  step(`habit-completed-${i}`,{type:'CompleteFocus'},1000);
}
save('habit-monument',state);
state=structuredClone(rich);
step('finite-early-active-1',{type:'StartFocus',sessionId:'early-read',subtaskId:'read',plannedDurationMs:60000},1000);
step('finite-early-complete-1',{type:'CompleteFocusEarly',reportId:'early-read-report'},1000);
step('finite-early-active-2',{type:'StartFocus',sessionId:'early-write',subtaskId:'write',plannedDurationMs:60000},1000);
step('finite-monument',{type:'CompleteFocusEarly',reportId:'early-write-report'},1000);
step('new-for-retirement',{type:'CreateProject',projectId:'retired-host',title:'临时任务',blueprintId:'cottage',subtasks:[{id:'keep',title:'保留'},{id:'retire',title:'删除'}]});
step('retired-subtask',{type:'RemoveSubtask',subtaskId:'retire'});
step('deleted-project',{type:'DeleteActiveProject',projectId:'retired-host'});

// Legacy inputs are derived explicitly. Expected migrations always run the formal parser.
for(let schema=1;schema<=14;schema++){
  const x=createInitialState('UTC');x.schemaVersion=schema;
  if(schema<15){delete x.birthday;delete x.birthdayRewards;}
  if(schema<14)delete x.quickNotes;
  if(schema<13)delete x.holidayRewards;
  if(schema<12)delete x.focusIntegrityPolicy.excursionThresholdSeconds;
  if(schema<6)delete x.worldSettings;
  else if(schema===6||schema===7)x.worldSettings.terrainGenerationVersion=3;
  if(schema<5)delete x.habitBuildings;
  if(schema<4)delete x.buildingBlueprintResources;
  if(schema<2){delete x.focusIntegrityPolicy;delete x.decorationBlueprintResources;delete x.decorationRewards;}
  assert(add(`legacy-${schema}`,x));
}
for(let schema=1;schema<=14;schema++){
  const x=structuredClone(states.reported);x.schemaVersion=schema;
  if(schema<15){delete x.birthday;delete x.birthdayRewards;}
  if(schema<14)delete x.quickNotes;
  if(schema<13)delete x.holidayRewards;
  if(schema<12)delete x.focusIntegrityPolicy.excursionThresholdSeconds;
  if(schema<7)for(const r of x.buildingBlueprintResources)delete r.displayName;
  if(schema<6)delete x.worldSettings;
  else if(schema===6||schema===7)x.worldSettings.terrainGenerationVersion=3;
  if(schema<5){
    x.projects=x.projects.filter(p=>p.kind==='finite');
    x.projectConditions=x.projectConditions.filter(r=>x.projects.some(p=>p.id===r.projectId));
    for(const p of x.projects){delete p.kind;delete p.habit;delete p.settlementIndex;}
    delete x.habitBuildings;
  }
  if(schema<4)delete x.buildingBlueprintResources;
  if(schema<3)for(const s of x.focusHistory)delete s.actualDurationMs;
  if(schema<2){delete x.focusIntegrityPolicy;delete x.decorationBlueprintResources;delete x.decorationRewards;}
  assert(add(`legacy-populated-${schema}`,x));
}
// Every populated record rejects missing/unknown fields; accepted normalizations compare complete output.
function mutations(value,path=[],base=rich){
  if(value===null||typeof value!=='object')return;
  if(!Array.isArray(value))for(const key of Object.keys(value)){
    const x=structuredClone(base);let p=x;for(const part of path)p=p[part];delete p[key];add(`missing:${[...path,key].join('.')}`,x);
  }
  if(!Array.isArray(value)){
    const x=structuredClone(base);let p=x;for(const part of path)p=p[part];p.unknownField=true;add(`unknown:${path.join('.')}`,x);
  }
  for(const [key,child]of Object.entries(value))if(child&&typeof child==='object')mutations(child,[...path,Array.isArray(value)?Number(key):key],base);
}
mutations(rich);
function mutate(name,fn,base=rich){const x=structuredClone(base);fn(x);add(name,x);}
mutate('duplicate-project',x=>x.projects.push(structuredClone(x.projects[0])));
mutate('duplicate-subtask',x=>x.projects[0].subtasks[1].id='read');
mutate('orphan-active',x=>x.activeProjectId='absent');
mutate('overlap-history',x=>x.focusHistory[1].startedAt=x.focusHistory[0].startedAt);
mutate('wrong-progress',x=>x.projects[0].subtasks[0].progressBasisPoints=6000);
mutate('orphan-report',x=>x.progressReports[0].focusSessionIds=['unknown']);
mutate('reused-report',x=>{const r=structuredClone(x.progressReports[0]);r.id='duplicate-use';x.progressReports.push(r);});
mutate('unreached-goal',x=>x.dailyGoals[0].reachedAt=null);
mutate('orphan-reward',x=>x.decorationRewards[0].resourceId='missing');
mutate('holiday-outside-window',x=>x.holidayRewards[0].year=2025);
mutate('invalid-note-bool',x=>x.quickNotes[0].completed=1);
mutate('invalid-note-text',x=>x.quickNotes[0].text=' '.repeat(20));
mutate('birthday-invalid',x=>{x.birthday.month=2;x.birthday.day=30;});
mutate('unsafe-number',x=>x.projects[0].settlementIndex=2**53);
mutate('invalid-date',x=>x.birthdayRewards[0].date='2026-02-30');
mutate('wrong-tz-date',x=>x.focusHistory[0].completedLocalDate='2026-10-02');
mutate('missing-tz',x=>x.calendar.timeZone='Not/A_Zone');
mutate('unsorted-weekdays',x=>x.calendar.restWeekdays=[6,0]);
mutate('misbounded-blueprint',x=>x.projects[0].importedBlueprint.bounds.maxX=4);
mutate('duplicate-voxel',x=>x.projects[0].importedBlueprint.voxels.push(structuredClone(x.projects[0].importedBlueprint.voxels[0])));
mutate('bad-piston',x=>x.projects[0].importedBlueprint.voxels[2].movingPistonPose.progress=1.1);
mutate('unsafe-blockstate',x=>x.projects[0].importedBlueprint.voxels[0].sourceBlockState.constructor='x');
mutate('invalid-campfire-slots',x=>x.projects[0].importedBlueprint.voxels[1].campfire.slots[0].slot=0);
mutate('sign-control',x=>x.projects[0].importedBlueprint.voxels[0].sign.front.lines=['bad\u0000']);
mutate('habit-double-use',x=>x.projects[1].habit.completedFocusSessionIds=['s1']);
for(const bad of [null,true,false,1,1.5,'x',[],{}])for(const key of Object.keys(rich))mutate(`root-type:${key}:${JSON.stringify(bad)}`,x=>x[key]=bad);
for(const key of Object.keys(rich.projects[0]))for(const bad of [null,1,true,[],{}])mutate(`project-type:${key}:${JSON.stringify(bad)}`,x=>x.projects[0][key]=bad);
for(const key of Object.keys(rich.focusHistory[0]))for(const bad of [null,true,[],{}])mutate(`focus-type:${key}:${JSON.stringify(bad)}`,x=>x.focusHistory[0][key]=bad);
const timeZones=['UTC','Asia/Shanghai','America/New_York','Europe/Berlin','Pacific/Apia','Etc/GMT+5','us/pacific','GMT','Etc/UTC','Etc/GMT0','GMT0','GMT+0','GMT-0','Greenwich','Universal','Zulu','CST','EST','MST','HST','PST','PST8PDT','CST6CDT','MST7MDT','EST5EDT','US/Eastern','Asia/Calcutta','Asia/Katmandu','ROC','ROK','PRC','Egypt','Cuba','Canada/Eastern','+01:00','-05:00','+23:59','+01','+0130','UTC+08:00','+24:00','+01:99','SystemV/AST4'];
for(const tz of timeZones){
  mutate(`zone:${tz}`,x=>x.calendar.timeZone=tz);
  try{new Intl.DateTimeFormat('en-US',{timeZone:tz});}catch{continue;}
  for(const at of ['2026-03-08T06:59:59.999Z','2026-11-01T05:59:59.999Z','2026-10-01T23:59:59.999Z']){
    let s=createInitialState(tz);const now=Date.parse(at);
    for(const [command,ms]of [[{type:'CreateProject',projectId:'tz',title:'Timezone',blueprintId:'cottage',subtasks:[{id:'tz-task',title:'Task'}]},now-1000],
      [{type:'StartFocus',sessionId:'tz-focus',subtaskId:'tz-task',plannedDurationMs:2},now],[{type:'CompleteFocus'},now+2]]){
      const result=execute(s,command,{now:()=>new Date(ms)});assert(result.ok);s=result.state;
    }
    assert(add(`zone-history:${tz}:${at}`,s));
  }
}
for(const at of ['0000-01-01T00:00:00.000Z','0100-01-01T00:00:00.000Z','9999-12-31T23:59:59.999Z','+010000-01-01T00:00:00.000Z','-000001-12-31T23:59:59.999Z','+275760-09-13T00:00:00.000Z','-271821-04-20T00:00:00.000Z','2026-10-01T08:00:00Z','2026-10-01T08:00:00.0000Z','2016-12-31T23:59:60.000Z','-000000-01-01T00:00:00.000Z'])mutate(`instant:${at}`,x=>x.projects[0].createdAt=at,states.project);
const holidayDates=[],holidayErrors=[];
for(const year of [100,999,1000,1582,1900,1960,2000,...Array.from({length:18},(_,i)=>2019+i),2100,9999]){
  try{for(const h of holidaysForYear(year))holidayDates.push({year,id:h.id,date:h.date});}
  catch(error){holidayErrors.push({year,error:String(error.message)});}
}
const sourceHashes={};
for(const file of readdirSync(path.join(root,'packages/domain/src')).filter(f=>f.endsWith('.ts'))){const name='packages/domain/src/'+file;sourceHashes[name]=hash(readFileSync(path.join(root,name)));}
sourceHashes['apps/native-android/tools/export-state-oracle.mjs']=hash(readFileSync(fileURLToPath(import.meta.url)));
for(const name of ['package-lock.json','node_modules/lunar-typescript/dist/index.mjs'])sourceHashes[name]=hash(readFileSync(path.join(root,name)));
const output=process.argv[2];assert(output,'Pass generated output directory');mkdirSync(output,{recursive:true});
writeFileSync(path.join(output,'state-oracle.json'),JSON.stringify({schema:1,sourceHashes,cases,holidayDates,holidayErrors,states}));
console.log(JSON.stringify({cases:cases.length,valid:cases.filter(c=>c.ok).length,holidayDates:holidayDates.length,holidayErrors,sources:Object.keys(sourceHashes).length}));
