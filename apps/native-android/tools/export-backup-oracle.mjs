import {buildSync} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{console.error(String(error.stack??error).split('\n').filter(s=>s.length<1200).join('\n'));process.exit(1);});
const root=fileURLToPath(new URL('../../../',import.meta.url));
const code=buildSync({stdin:{contents:`export * from './packages/storage-indexeddb/src/codec.ts';export * from './packages/storage-indexeddb/src/compact-backup.ts';`,resolveDir:root},bundle:true,write:false,platform:'node',format:'esm'}).outputFiles[0].text;
const {parseBackup,createBackupEnvelope,packBackupPayload,sha256,canonicalJson}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const stateOracle=JSON.parse(readFileSync(path.join(root,'apps/native-android/domain-core/build/generated/state-oracle/state-oracle.json'),'utf8'));
const cases=[];const exportedAt='2026-10-22T08:00:00.000Z';
async function add(name,envelope){const text=JSON.stringify(envelope);try{const p=await parseBackup(text);cases.push({name,text,ok:true,canonical:canonicalJson(p.payload),checksum:p.checksum,schema:p.schemaVersion});}catch(e){cases.push({name,text,ok:false,error:e.code??e.name});}}
async function signed(payload,schema=2){const unsigned={format:'tomato-clock-backup',schemaVersion:schema,exportedAt,payload};return{...unsigned,checksum:await sha256(unsigned)};}
const outputs=[];
for(const name of ['empty','project','notes','active','background','complete','reported','allocation','interrupted','decay','habit-monument','finite-monument','deleted-project']){
  const domain=stateOracle.states[name];assert(domain,name);
  const legacy=await createBackupEnvelope(domain,new Date(exportedAt));await add('v1:'+name,legacy);
  const compact=await signed(packBackupPayload(domain));await add('v2:'+name,compact);
  outputs.push({name,domain,exportedAt,legacy:canonicalJson(legacy),compact:canonicalJson(compact)});
}
for(const c of stateOracle.cases.filter(c=>c.ok&&c.name.startsWith('legacy-populated-')))await add('old-domain:'+c.name,await signed(c.input,1));
const valid=await signed(packBackupPayload(stateOracle.states.decay));
for(const [name,mutate,resign=true]of [
  ['wrong-checksum',x=>x.checksum='a'.repeat(64),false],['unknown-envelope',x=>x.extra=1,false],['missing-envelope',x=>delete x.exportedAt,false],
  ['missing-reference',x=>x.payload.state.projects[0].importedBlueprint.$blueprint=999],
  ['negative-reference',x=>x.payload.state.projects[0].importedBlueprint.$blueprint=-1],
  ['reference-extra',x=>x.payload.state.projects[0].importedBlueprint.extra=true],
  ['unreferenced',x=>x.payload.blueprints.push(structuredClone(x.payload.blueprints[0]))],
  ['palette-coordinate',x=>x.payload.blueprints[0].palette[0].x=0],
  ['bad-palette-index',x=>x.payload.blueprints[0].voxels[0][3]=999],
  ['fractional-coordinate',x=>x.payload.blueprints[0].voxels[0][0]=0.5],
  ['missing-owner-array',x=>delete x.payload.state.habitBuildings],
  ['unknown-domain',x=>x.payload.state.unknown=true],
]){const x=structuredClone(valid);mutate(x);if(resign){delete x.checksum;x.checksum=await sha256(x);}await add(name,x);}
const amplified=structuredClone(valid);amplified.payload.blueprints[0].palette[0].extra='x'.repeat(100000);
amplified.payload.blueprints[0].voxels=Array.from({length:6000},(_,i)=>[i,0,0,0]);delete amplified.checksum;amplified.checksum=await sha256(amplified);await add('expanded-budget-before-allocation',amplified);
const names=['packages/storage-indexeddb/src/codec.ts','packages/storage-indexeddb/src/compact-backup.ts','packages/storage-indexeddb/src/model.ts','apps/native-android/tools/export-backup-oracle.mjs'];
const sourceHashes=Object.fromEntries(names.map(name=>[name,createHash('sha256').update(readFileSync(path.join(root,name))).digest('hex')]));
const out=process.argv[2];assert(out);mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'backup-oracle.json'),JSON.stringify({schema:1,sourceHashes,cases,outputs}));
console.log(JSON.stringify({cases:cases.length,accepted:cases.filter(c=>c.ok).length,exportPairs:outputs.length}));
