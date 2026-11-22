import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

// Export immutable source assets, not layouts or a prebuilt 25-house world.
// The runtime consumes JSON only; no JS engine or executable bundle is shipped.
const root=fileURLToPath(new URL('../../../',import.meta.url)),argument=process.argv[2];
if(!argument)throw Error('Bundled blueprint output directory required');
const output=path.resolve(argument),relativeOutput=path.relative(root,output).replaceAll('\\','/').toLowerCase();
assert.ok(relativeOutput.startsWith('apps/native-android/world-core/build/')||relativeOutput.startsWith('artifacts/experiments/v3.0.0/'),'Generated blueprint files must stay in their build/evidence directory');
const sourceHashes={},sha=b=>createHash('sha256').update(b).digest('hex');
const track=file=>{const absolute=path.resolve(root,file),relative=path.relative(root,absolute).replaceAll('\\','/');assert.ok(!relative.startsWith('../'));sourceHashes[relative]=sha(readFileSync(absolute));};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const assetsPlugin={name:'source-blueprint-globs',setup(build){
 build.onLoad({filter:/[\\/]voxel[\\/]src[\\/]blueprint\.ts$/},args=>{
  let replacements=0;const source=readFileSync(args.path,'utf8').replace(/import\.meta\.glob<unknown>\("\.\/local-blueprints\/(buildings|daily-rewards)\/\*\.json",\s*\{[\s\S]*?\}\)/g,(_,category)=>{
   replacements++;const directory=path.join(root,'packages/voxel/src/local-blueprints',category),assets={};
   for(const name of readdirSync(directory).filter(name=>name.endsWith('.json')).sort()){
    const relative=`packages/voxel/src/local-blueprints/${category}/${name}`;track(relative);
    assets[`./local-blueprints/${category}/${name}`]=JSON.parse(readFileSync(path.join(root,relative),'utf8'));
   }
   return `JSON.parse(${JSON.stringify(JSON.stringify(assets))})`;
  });
  assert.equal(replacements,2,'Formal blueprint glob declarations changed; update the explicit asset exporter');
  return {contents:source,loader:'ts',resolveDir:path.dirname(args.path)};
 });
}};
async function load(relative){
 const compiled=await build({absWorkingDir:root,entryPoints:[relative],bundle:true,write:false,platform:'node',format:'esm',plugins:[assetsPlugin],metafile:true,preserveSymlinks:true});
 for(const input of Object.keys(compiled.metafile.inputs))track(input);
 return import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
}
const blueprint=await load('packages/voxel/src/blueprint.ts');
const {LOCAL_BUILTIN_SOURCES}=await load('packages/voxel/src/local-blueprint-sources.ts');
const {holidayBuildingBlueprint,birthdayBuildingBlueprint}=await load('packages/voxel/src/holiday-buildings.ts');
const {holidaysForYear}=await load('packages/domain/src/holidays.ts');
const index=[],directory=path.join(output,'native-blueprints');mkdirSync(directory,{recursive:true});
function add(value,category,displayName,description,complexity='simple',holidayId=null){
 const validated=blueprint.validateBlueprint(value),canonicalText=canonical(validated),bytes=Buffer.from(canonicalText),hash=sha(bytes);
 assert.ok(!index.some(entry=>entry.id===validated.id),'Duplicate bundled blueprint identity');
 writeFileSync(path.join(directory,hash+'.json'),bytes);
 index.push({id:validated.id,category,displayName,description,complexity,holidayId,sha256:hash,bytes:bytes.length,bounds:validated.bounds,voxelCount:validated.voxels.length});
}
for(const entry of blueprint.BUILTIN_BLUEPRINT_CATALOG)add(entry.blueprint,entry.id.startsWith('builtin-local-')?'supplemental':'native',entry.displayName,entry.description,entry.complexity);
for(const value of blueprint.BUILTIN_DAILY_REWARD_BLUEPRINTS)add(value,'daily',value.title,blueprint.localBuiltinBlueprintDescription(value.id,value.title));
for(const holiday of holidaysForYear(2026))add(holidayBuildingBlueprint(holiday.id,holiday.buildingName),'holiday',holiday.buildingName,holiday.description,'simple',holiday.id);
add(birthdayBuildingBlueprint(),'birthday','生日小蛋糕','开启生日祝福，生日当天启动即可获得。');
add(blueprint.UNKNOWN_BLUEPRINT_PLACEHOLDER,'placeholder','???','也许在某些特定节日启动方块钟会发现它');
for(const source of Object.values(LOCAL_BUILTIN_SOURCES))assert.ok(index.some(entry=>entry.id===source.id),'Registered supplemental asset is absent: '+source.id);
track('apps/native-android/tools/export-bundled-blueprints.mjs');track('package-lock.json');
writeFileSync(path.join(directory,'catalog.json'),canonical({schema:1,sourceHashes,entries:index}));
// Only obsolete content-addressed files in this validated GENERATED directory
// are collected; raw source blueprints, imports and historical evidence stay.
const active=new Set(index.map(entry=>entry.sha256+'.json'));let collected=0;
for(const name of readdirSync(directory))if(/^[a-f0-9]{64}\.json$/.test(name)&&!active.has(name)){
 const file=path.resolve(directory,name);assert.equal(path.dirname(file),directory);assert.ok(lstatSync(file).isFile(),'Unexpected generated asset type');unlinkSync(file);collected++;
}
console.log(JSON.stringify({entries:index.length,voxels:index.reduce((n,e)=>n+e.voxelCount,0),bytes:index.reduce((n,e)=>n+e.bytes,0),categories:Object.fromEntries([...new Set(index.map(e=>e.category))].map(c=>[c,index.filter(e=>e.category===c).length])),sources:Object.keys(sourceHashes).length,collected}));
