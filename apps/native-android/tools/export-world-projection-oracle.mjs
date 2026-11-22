import {buildSync} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];if(!output)throw Error('World projection oracle directory required');
const sourceHashes={},sha=b=>createHash('sha256').update(b).digest('hex');
async function load(relative){
 const built=buildSync({entryPoints:[path.join(root,relative)],bundle:true,write:false,platform:'node',format:'esm',metafile:true,preserveSymlinks:true});
 for(const input of Object.keys(built.metafile.inputs)){const absolute=path.resolve(input),name=path.relative(root,absolute).replaceAll('\\','/');assert.ok(!name.startsWith('../'));sourceHashes[name]=sha(readFileSync(absolute));}
 return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
}
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const corpus=JSON.parse(readFileSync(path.join(root,'apps/native-android/domain-core/build/generated/command-oracle/command-oracle.json'),'utf8'));
for(const [name,expected]of Object.entries(corpus.sourceHashes)){assert.equal(sha(readFileSync(path.join(root,name))),expected,'Stale world source corpus: '+name);sourceHashes[name]=expected;}
const {parseDomainState,createInitialState,execute}=await load('packages/domain/src/index.ts');
const {projectWorldState}=await load('packages/application/src/model.ts');
const {decorationDatesByProject}=await load('apps/web/src/world-projection.ts');
const {holidayBuildingBlueprint}=await load('packages/voxel/src/holiday-buildings.ts');
const cases=[],seen=new Set();
const inputs=corpus.cases.map((entry,caseIndex)=>({...entry,caseIndex}));
const states=JSON.parse(readFileSync(path.join(root,'apps/native-android/domain-core/build/generated/state-oracle/state-oracle.json'),'utf8'));
for(const [name,expected]of Object.entries(states.sourceHashes)){assert.equal(sha(readFileSync(path.join(root,name))),expected,'Stale saved-state corpus: '+name);sourceHashes[name]=expected;}
for(const [name,value]of Object.entries(states.states))inputs.push({name:'saved:'+name,caseIndex:null,canonical:canonical(parseDomainState(value))});
let ownerState=createInitialState('UTC'),now=Date.parse('2026-10-25T08:00:00.000Z');
const first=structuredClone(states.states.project.projects[0].importedBlueprint),second=structuredClone(first);second.title='Same ID, different saved geometry';second.voxels[0].materialId='glass';
for(const command of [
 {type:'CreateProject',projectId:'owner-a',title:'First frozen source',blueprintId:first.id,importedBlueprint:first,subtasks:[{id:'owner-a-task',title:'A'}]},
 {type:'CreateProject',projectId:'owner-b',title:'Second frozen source',blueprintId:second.id,importedBlueprint:second,subtasks:[{id:'owner-b-task',title:'B'}]},
 {type:'ImportBuildingBlueprint',blueprint:{...structuredClone(second),title:'Catalog is not a history override'}}
]){
 const result=execute(ownerState,command,{now:()=>new Date(now++)});assert.ok(result.ok,'Owner-source scenario: '+result.code);ownerState=parseDomainState(result.state);
 inputs.push({name:'owner-source:'+command.type+':'+ownerState.projects.length,caseIndex:null,canonical:canonical(ownerState)});
}
for(const entry of inputs){
 if(seen.has(entry.canonical))continue;seen.add(entry.canonical);
 const state=parseDomainState(JSON.parse(entry.canonical)),projection=projectWorldState(state,holidayBuildingBlueprint),dates=decorationDatesByProject(state);
 const habitById=new Map(state.habitBuildings.map(b=>[b.id,b]));
 const buildings=projection.projects.map(value=>{
  const habit=habitById.get(value.project.id),embedded=value.building.importedBlueprint;
  const blueprint={id:value.building.blueprintId,kind:embedded?'EMBEDDED':'BUILTIN',embeddedCanonical:embedded?canonical(embedded):null,holidayId:null,year:null};
  const rewards=value.importedDecorations.map(reward=>{
   const birthday=reward.rewardId.startsWith('birthday:'),holiday=reward.rewardId.startsWith('holiday:');
   const parts=reward.rewardId.split(':');const year=birthday?Number(parts[1]):holiday?Number(parts.at(-1)):null;
   return {rewardId:reward.rewardId,resourceId:reward.resourceId,date:reward.date,localX:reward.localPosition.x,localZ:reward.localPosition.z,quarterTurns:reward.rotationQuarterTurns,
    blueprint:{id:reward.resourceId,kind:birthday?'BIRTHDAY':holiday?'HOLIDAY':'EMBEDDED',embeddedCanonical:!birthday&&!holiday?canonical(reward.blueprint):null,holidayId:holiday?parts[1]:null,year}};
  });
  return {id:value.project.id,title:habit?habit.habitTitle:value.project.title,cycleNumber:habit?habit.cycleNumber:null,status:value.project.status,kind:value.project.kind,active:value.isActive,
   settlementIndex:value.settlementIndex,blueprint,completion:value.building.completionBasisPoints,condition:value.building.conditionBasisPoints,decorationDates:dates.get(value.project.id)??[],rewards};
 });
 cases.push({caseIndex:entry.caseIndex,name:entry.name,...(entry.caseIndex===null?{inputCanonical:entry.canonical}:{}),activeProjectId:projection.activeProjectId,seed:state.worldSettings.worldSeed,environment:state.worldSettings.environmentStyle,terrainVersion:state.worldSettings.terrainGenerationVersion,buildings});
}
for(const relative of ['apps/native-android/tools/export-world-projection-oracle.mjs','package-lock.json'])sourceHashes[relative]=sha(readFileSync(path.join(root,relative)));
mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'world-projection-oracle.json'),JSON.stringify({schema:1,sourceHashes,cases}));
console.log(JSON.stringify({cases:cases.length,buildings:cases.reduce((n,c)=>n+c.buildings.length,0),rewards:cases.reduce((n,c)=>n+c.buildings.reduce((m,b)=>m+b.rewards.length,0),0),sources:Object.keys(sourceHashes).length}));
