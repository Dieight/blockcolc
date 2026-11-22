import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../../',import.meta.url)),out=path.resolve(process.argv[2]??'');
assert.ok(out.startsWith(path.join(repo,'apps/native-android/presentation-core/build/generated')+path.sep));
const hashes={},sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex');
const realDependencies=fs.realpathSync(path.join(repo,'node_modules'));
function inputPath(input) {
 const absolute=path.resolve(input),dependency=path.relative(realDependencies,absolute);
 const insideDependencies=!path.isAbsolute(dependency)&&dependency!=='..'&&!dependency.startsWith(`..${path.sep}`);
 const relative=insideDependencies?path.join('node_modules',dependency):path.relative(repo,absolute);
 const normalized=relative.replaceAll('\\','/');
 assert.ok(!path.isAbsolute(relative)&&!normalized.startsWith('../'));
 return normalized;
}
async function load(file){const compiled=await build({entryPoints:[path.join(repo,file)],bundle:true,write:false,platform:'node',format:'esm',metafile:true,preserveSymlinks:true,logLevel:'silent'});
 for(const input of Object.keys(compiled.metafile.inputs)){const p=inputPath(input);hashes[p]=sha(p);}
 return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);}
const world=JSON.parse(fs.readFileSync(path.join(repo,'apps/native-android/presentation-core/build/generated/world-projection-oracle/world-projection-oracle.json'),'utf8'));
for(const [file,hash]of Object.entries(world.sourceHashes)){assert.equal(sha(file),hash);hashes[file]=hash;}
const corpus=JSON.parse(fs.readFileSync(path.join(repo,'apps/native-android/domain-core/build/generated/command-oracle/command-oracle.json'),'utf8'));
const {parseDomainState}=await load('packages/domain/src/index.ts');
const {projectWorldState}=await load('packages/application/src/model.ts');
const {projectMonumentFocus}=await load('packages/application/src/focus-attribution.ts');
const {holidayBuildingBlueprint}=await load('packages/voxel/src/holiday-buildings.ts');
const {createBuildingMemory}=await load('apps/web/src/BuildingMemoryPanel.tsx');
const cases=world.cases.map(c=>{
 const canonical=c.caseIndex===null?c.inputCanonical:corpus.cases[c.caseIndex].canonical,state=parseDomainState(JSON.parse(canonical));
 const projection=projectWorldState(state,holidayBuildingBlueprint);
 return {name:c.name,canonical,memories:projection.projects.map(p=>createBuildingMemory(state,p,'reference-label')),
  archives:projectMonumentFocus(state),rewards:projection.projects.flatMap(p=>p.importedDecorations.map(r=>({id:`reward:${r.rewardId}`,date:r.date,resource:r.resourceId})))};
});
const self=path.relative(repo,fileURLToPath(import.meta.url)).replaceAll('\\','/');hashes[self]=sha(self);hashes['package-lock.json']=sha('package-lock.json');
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'building-memory-oracle.json'),JSON.stringify({schema:1,sourceHashes:hashes,cases}));
console.log(`Building memories: ${cases.length} formal saved states, ${cases.reduce((n,c)=>n+c.memories.length,0)} memories and ${cases.reduce((n,c)=>n+c.archives.length,0)} archives.`);
