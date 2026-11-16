import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';

const repo=fileURLToPath(new URL('../../../',import.meta.url)),out=path.resolve(process.argv[2]??'');
assert.ok(out.startsWith(path.join(repo,'apps/native-android/world-core/build/')));
const sourceHashes={};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
async function load(contents){const r=buildSync({stdin:{contents,loader:'ts',resolveDir:repo},absWorkingDir:repo,bundle:true,write:false,platform:'node',format:'esm',metafile:true});
 for(const p of Object.keys(r.metafile.inputs).filter(p=>p!=='<stdin>'))sourceHashes[p.replaceAll('\\','/')]=sha(fs.readFileSync(path.join(repo,p)));
 return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));}
const helperPath='packages/litematic/test/litematic.test.ts',helperSource=fs.readFileSync(path.join(repo,helperPath),'utf8');
sourceHashes[helperPath]=sha(helperSource);
const factories=helperSource.slice(helperSource.indexOf('type Point ='));
assert.ok(factories.includes('function makeLitematic')&&factories.includes('function pack'));
const {parseLitematic,nbt,writeJavaNbt,makeRegion,makeLitematic,blockTileEntity,pistonTileEntity}=await load(`
import {gzipSync} from 'node:zlib';
import {testNbt as nbt,writeJavaNbt,type TestNbtTag} from './packages/litematic/test/nbt-fixture.ts';
import {parseLitematic} from './packages/litematic/src/index.ts';
${factories}
export {parseLitematic,nbt,writeJavaNbt,makeRegion,makeLitematic,blockTileEntity,pistonTileEntity};`);
const cases=[];
async function add(name,bytes,limits){let result=null,error=null;try{result=await parseLitematic(bytes,{limits});}catch(e){error=e.code;assert.equal(typeof error,'string',name);}
 const stages=result?.blueprint.voxels.map(v=>({...v,stage:v.buildOrder<1800?'foundation':v.buildOrder<3800?'frame':v.buildOrder<6500?'walls':v.buildOrder<8800?'roof':'details'}));
 const blueprint=result?{...result.blueprint,voxels:stages}:null;
 cases.push({name,input:Buffer.from(bytes).toString('base64'),limits:limits??{},error,sha:blueprint?sha(canonical(blueprint)):null,preview:result?.preview??null});}
const region=(size,palette,values,tiles=[])=>makeRegion({position:{x:0,y:0,z:0},size,palette,values,tileEntities:tiles});
const palette=['minecraft:stone','minecraft:oak_planks','minecraft:red_wool','minecraft:glass',{name:'minecraft:oak_stairs',properties:{facing:'north',half:'bottom',shape:'inner_left'}},{name:'minecraft:lantern',properties:{hanging:'false'}},{name:'minecraft:oak_log',properties:{axis:'z'}},'example:unknown'];
for(let mask=0;mask<8;mask++)await add('direction-'+mask,makeLitematic({regions:{selection:makeRegion({position:{x:10+(mask&1?1:0),y:20+(mask&2?1:0),z:30+(mask&4?1:0)},size:{x:mask&1?-2:2,y:mask&2?-2:2,z:mask&4?-2:2},palette,values:[0,1,2,3,4,5,6,7]})}}));
await add('overlap-air',makeLitematic({regions:{'a-base':region({x:4,y:1,z:1},['minecraft:stone'],[0,0,0,0]),'b-overlay':makeRegion({position:{x:1,y:0,z:0},size:{x:-2,y:1,z:1},palette:['minecraft:air','minecraft:glass'],values:[0,1]})}}));
await add('connected-and-detached',makeLitematic({regions:{r:region({x:3,y:3,z:2},palette,Array.from({length:18},(_,i)=>i%8))}}));
const lights=['torch','wall_torch','soul_torch','soul_wall_torch','lantern','soul_lantern','campfire','soul_campfire','glowstone','sea_lantern','shroomlight','ochre_froglight','end_rod','jack_o_lantern','redstone_torch','redstone_wall_torch','redstone_lamp','magma_block','crying_obsidian','glow_lichen','fire','soul_fire','copper_torch','waxed_oxidized_copper_lantern','oxidized_copper_bulb','exposed_copper_bulb','red_candle','sea_pickle','respawn_anchor','light'].map(name=>({name:'minecraft:'+name,properties:{lit:'true',candles:'4',pickles:'3',charges:'2',level:'6'}}));
await add('light-semantics',makeLitematic({regions:{r:region({x:lights.length,y:1,z:1},lights,lights.map((_,i)=>i))}}));
await add('unlit-lights',makeLitematic({regions:{r:region({x:lights.length,y:1,z:1},lights.map(v=>({...v,properties:{...v.properties,lit:'false',waterlogged:'false'}})),lights.map((_,i)=>i))}}));
for(let facing=0;facing<6;facing++)for(const extending of [0,1]){
 const tile=pistonTileEntity(0,0,0,nbt.compound({Name:nbt.string('minecraft:oak_stairs'),Properties:nbt.compound({facing:nbt.string('west')})}),{facing:nbt.int(facing),progress:nbt.float(.6),extending:nbt.byte(extending),source:nbt.byte(1)});
 await add(`piston-${facing}-${extending}`,makeLitematic({regions:{r:region({x:1,y:1,z:1},['minecraft:moving_piston'],[0],[tile])}}));
}
for(const bad of ['facing','progress','extending','source']){
 const pose={facing:nbt.int(3),progress:nbt.float(.5),extending:nbt.byte(1),source:nbt.byte(0)};pose[bad]=nbt.string('wrong');
 await add('piston-bad-'+bad,makeLitematic({regions:{r:region({x:1,y:1,z:1},['minecraft:moving_piston'],[0],[pistonTileEntity(0,0,0,nbt.compound({Name:nbt.string('minecraft:stone')}),pose)])}}));
}
const face=(messages)=>nbt.compound({messages:nbt.list(8,messages.map(nbt.string)),color:nbt.string('cyan'),has_glowing_text:nbt.byte(1)});
await add('sign-legacy',makeLitematic({regions:{r:region({x:1,y:1,z:1},['minecraft:oak_sign'],[0],[blockTileEntity('minecraft:sign',0,0,0,{Text1:nbt.string('{"text":"你好","extra":[{"text":" world"}]}'),Text2:nbt.string('"第二行"'),Color:nbt.string('blue'),GlowingText:nbt.byte(1)})])}}));
await add('sign-modern-json',makeLitematic({regions:{r:region({x:1,y:1,z:1},['minecraft:oak_wall_sign'],[0],[blockTileEntity('minecraft:sign',0,0,0,{front_text:face(['{"text":"Front","bold":true,"clickEvent":{"action":"run_command","value":"ignored"}}']),back_text:face(['"Back"'])})])}}));
const direct=nbt.compound({messages:nbt.list(10,[nbt.compound({'':nbt.string('literal')})]),color:nbt.string('red'),has_glowing_text:nbt.byte(1)});
await add('sign-direct-nbt',makeLitematic({dataVersion:4298,regions:{r:region({x:1,y:1,z:1},['minecraft:oak_hanging_sign'],[0],[blockTileEntity('minecraft:hanging_sign',0,0,0,{front_text:direct})])}}));
for(const component of ['{"translate":"dynamic"}','{"text":"x","unknown":1}','"'+('x'.repeat(257))+'"','{"text":"line\\ncontrol"}'])await add('reject-sign-'+cases.length,makeLitematic({regions:{r:region({x:1,y:1,z:1},['minecraft:oak_sign'],[0],[blockTileEntity('minecraft:sign',0,0,0,{Text1:nbt.string(component)})])}}));
for(const count of ['Count','count'])await add('campfire-'+count,makeLitematic({regions:{r:region({x:1,y:1,z:1},['minecraft:campfire'],[0],[blockTileEntity('minecraft:campfire',0,0,0,{Items:nbt.list(10,[nbt.compound({Slot:nbt.byte(3),id:nbt.string('minecraft:potato'),[count]:nbt.byte(2)})])})])}}));
await add('reject-item-model',makeLitematic({regions:{r:region({x:1,y:1,z:1},['minecraft:campfire'],[0],[blockTileEntity('minecraft:campfire',0,0,0,{Items:nbt.list(10,[nbt.compound({Slot:nbt.byte(0),id:nbt.string('minecraft:potato'),count:nbt.byte(1),components:nbt.compound({'minecraft:custom_model_data':nbt.int(1)})})])})])}}));
const dense=makeLitematic({regions:{r:region({x:60,y:60,z:60},['minecraft:stone'],Array(60**3).fill(0))}});
await add('dense-60-cubed',dense);
await add('reject-output-limit',dense,{maxOutputVoxels:100});
await add('reject-axis-limit',dense,{maxHorizontalAxisLength:59});
await add('reject-inflate-limit',dense,{maxUncompressedBytes:100});
await add('reject-input-limit',dense,{maxCompressedBytes:4});
await add('reject-regions',makeLitematic({regions:{a:region({x:1,y:1,z:1},['minecraft:stone'],[0]),b:region({x:1,y:1,z:1},['minecraft:glass'],[0])}}),{maxRegions:1});
await add('reject-palette',makeLitematic({regions:{a:region({x:1,y:1,z:1},palette,[0])}}),{maxPaletteEntries:3});
await add('bad-long-count',makeLitematic({regions:{r:makeRegion({position:{x:0,y:0,z:0},size:{x:3,y:1,z:1},palette:['minecraft:stone'],values:[0,0,0],omitLastLong:true})}}));
await add('missing-palette-index',makeLitematic({regions:{r:region({x:1,y:1,z:1},['minecraft:stone'],[3])}}));
await add('plain-nbt-is-not-user-format',writeJavaNbt(nbt.compound({hello:nbt.string('NBT')})));
await add('bad-negative-list',gzipSync(Buffer.from([10,0,0,9,0,1,120,3,255,255,255,255,0])));
sourceHashes['apps/native-android/tools/export-native-litematic-oracle.mjs']=sha(fs.readFileSync(fileURLToPath(import.meta.url)));
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-litematic-oracle.json'),JSON.stringify({schema:1,sourceHashes,cases}));
console.log(JSON.stringify({cases:cases.length,success:cases.filter(c=>!c.error).length,sources:Object.keys(sourceHashes).length}));
