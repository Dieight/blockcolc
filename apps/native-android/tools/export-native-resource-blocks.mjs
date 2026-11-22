import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {zipSync,zlibSync,strToU8} from 'fflate';
const repo=fileURLToPath(new URL('../../../',import.meta.url)),out=path.resolve(process.argv[2]??'');
assert.ok(out.startsWith(path.join(repo,'apps/native-android/world-core/build/generated')+path.sep));
const bundle=buildSync({absWorkingDir:repo,entryPoints:['packages/resource-pack/src/index.ts'],bundle:true,platform:'node',format:'esm',metafile:true,preserveSymlinks:true,write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),json=v=>strToU8(JSON.stringify(v));
const sourceHashes=Object.fromEntries(Object.keys(bundle.metafile.inputs).map(p=>[p.replaceAll('\\','/'),sha(fs.readFileSync(path.join(repo,p)))]));
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(name,b){const v=Buffer.alloc(b.length+12);v.writeUInt32BE(b.length);v.write(name,4);v.set(b,8);v.writeUInt32BE(crc(v.subarray(4,v.length-4)),v.length-4);return v;}
const header=Buffer.alloc(13);header.writeUInt32BE(16);header.writeUInt32BE(16,4);header[8]=8;header[9]=6;
const raw=Buffer.alloc(16*65,255);for(let i=0;i<16;i++)raw[i*65]=0;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlibSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const faces=['down','up','north','south','west','east'];
const modelPath=id=>`assets/minecraft/models/block/${id}.json`,statePath=id=>`assets/minecraft/blockstates/${id}.json`;
const cube=(overrides={})=>({textures:{all:'block/a'},elements:[{from:[0,0,0],to:[16,16,16],faces:Object.fromEntries(faces.map(f=>[f,{texture:'#all'}]))}],...overrides});
const defaults=()=>({'pack.mcmeta':json({pack:{pack_format:97,description:'source model oracle'}}),
 ...Object.fromEntries(['a','b','c'].map(id=>[`assets/minecraft/textures/block/${id}.png`,png])),
 [modelPath('a')]:json(cube()),[modelPath('b')]:json(cube({textures:{all:'block/b'}})),[modelPath('c')]:json(cube({textures:{all:'block/c'}}))});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const blockIssueCodes=new Set(['INVALID_BLOCKSTATE_JSON','UNSUPPORTED_MULTIPART','INVALID_MODEL_JSON','COMPLEX_MODEL_GEOMETRY']);
const normalized=parsed=>({blockStates:parsed.blockStates,models:parsed.models,issues:(parsed.issues??parsed.summary.issues.filter(i=>blockIssueCodes.has(i.code))).map(({path,code})=>({path,code}))});
const queries=(id='test')=>[{blockId:`minecraft:${id}`,state:{}}];
const cases=[];
function record(name,files,requests=queries()){
 const input={...defaults(),...Object.fromEntries(Object.entries(files).map(([p,v])=>[p,v instanceof Uint8Array?v:json(v)]))};
 const bytes=zipSync(input),parsed=api.parseJava16xResourcePack(bytes);
 const expected=normalized(parsed);
 const recognized=api.parseBlockAssets(input,Object.keys(input),(b)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b))).recognizedPaths;
 expected.recognizedPaths=[...recognized].sort();
 const resolutions=requests.map(q=>({...q,geometry:api.resolveBlockGeometry(parsed,q.blockId,q.state,q.position),textures:api.resolveBlockTextures(parsed,q.blockId,q.state,q.position)}));
 cases.push({name,zip:Buffer.from(bytes).toString('base64'),expected,resolutions});
}
record('simple', {[statePath('test')]:{variants:{'':{model:'block/a'}}}});
const allRefs=Object.fromEntries(faces.map(f=>[f,'block/a']));
for(const builtin of ['block','cube','cube_all','cube_column','cube_bottom_top','cube_top','orientable','orientable_with_bottom','cube_directional','cube_mirrored','cube_north_west_mirrored']){
 record('builtin-'+builtin,{[statePath('test')]:{variants:{'':{model:'block/test'}}},[modelPath('test')]:{parent:`block/${builtin}`,textures:{...allRefs,all:'block/a',side:'block/b',end:'block/c',bottom:'block/b',top:'block/c',front:'block/a'}}});
}
for(const x of [0,90,180,270])for(const y of [0,90,180,270])for(const uvlock of [false,true]){
 const geometry=cube();geometry.elements[0]={...geometry.elements[0],from:[1,2,3],to:[14,13,12],faces:Object.fromEntries(faces.map((f,i)=>[f,{texture:'#all',uv:[i,1,16,15],rotation:i%4*90,cullface:f,tintindex:i}]))};
 record(`rotate-${x}-${y}-${uvlock}`,{[statePath('test')]:{variants:{'':{model:'block/test',x,y,uvlock}}},[modelPath('test')]:geometry});
}
for(const [name,element]of Object.entries({plane:{from:[8,0,0],to:[8,16,16]},reversed:{from:[16,16,16],to:[0,0,0]},oversize:{from:[-16,-16,-16],to:[32,32,32]},
 axis:{rotation:{origin:[8,8,8],axis:'y',angle:22.5,rescale:true}},euler:{rotation:{origin:[8,8,8],x:15,y:30,z:-70}},unshaded:{shade:false},direction:{shade_direction_override:'west'}})){
 const geometry=cube();geometry.elements[0]={...geometry.elements[0],...element};record(name,{[modelPath('test')]:geometry,[statePath('test')]:{variants:{'':{model:'block/test',x:90,y:270,uvlock:true}}}});
}
record('descriptor-and-parent',{[modelPath('parent')]:cube({textures:{all:{sprite:'#next',force_translucent:true},next:'block/a'}}),
 [modelPath('test')]:{parent:'block/parent',textures:{next:'block/b'}},[statePath('test')]:{variants:{'':{model:'block/test'}}}});
record('child-elements-replace',{[modelPath('parent')]:cube(),[modelPath('test')]:cube({parent:'block/parent',elements:[{from:[1,1,1],to:[2,2,2],faces:{up:{texture:'block/b'}}}]}),[statePath('test')]:{variants:{'':{model:'block/test'}}}});
record('variant-specificity',{[statePath('test')]:{variants:{'':{model:'block/a'},'axis=y':{model:'block/b'},'shape=x,axis=y':{model:'block/c'}}}},[{}, {axis:'y'},{axis:'x'},{shape:'x',axis:'y'}].map(state=>({blockId:'minecraft:test',state})));
const positions=[undefined,{x:0,y:0,z:0},{x:1,y:2,z:3},{x:-1,y:0,z:1},{x:255,y:64,z:-128},{x:2147483647,y:-2147483648,z:2147483647},{x:.5,y:0,z:0},{x:2147483648,y:0,z:0}];
for(let i=0;i<128;i++)positions.push({x:(i*7919)%1000-500,y:i*7%384-64,z:i*313%2048-1024});
record('position-weighted',{[statePath('test')]:{variants:{'':[{model:'block/c',weight:3},{model:'block/a',weight:2},{model:'block/b'}]}}},positions.map(position=>({blockId:'minecraft:test',state:{z:'后',a:'x'},...(position?{position}:{})})));
const multipart=[{apply:{model:'block/a'}},{when:{OR:[{east:'true'},{AND:[{waterlogged:'true'},{east:'false'}]}]},apply:[{model:'block/b',weight:3},{model:'block/c',weight:2}]}];
record('multipart-boolean',{[statePath('test')]:{multipart}},positions.flatMap(position=>[{}, {east:'true',waterlogged:'false'},{east:'false',waterlogged:'true'},{east:'false',waterlogged:'false'}].map(state=>({blockId:'minecraft:test',state,...(position?{position}:{})}))));
record('multipart-and-intersection',{[statePath('test')]:{multipart:[{when:{AND:[{axis:'x|y'},{axis:'y|z'}]},apply:{model:'block/a'}}]}},[{blockId:'minecraft:test',state:{axis:'y'}},{blockId:'minecraft:test',state:{axis:'x'}}]);
record('geometry-budget',{[statePath('test')]:{multipart:Array.from({length:3},()=>({apply:{model:'block/test'}}))},[modelPath('test')]:cube({elements:Array.from({length:64},()=>cube().elements[0])})});
for(const [name,files]of Object.entries({missingModel:{[statePath('test')]:{variants:{'':{model:'block/missing'}}}},modelCycle:{[statePath('test')]:{variants:{'':{model:'block/test'}}},[modelPath('test')]:{parent:'block/cycle'},[modelPath('cycle')]:{parent:'block/test'}},
 missingTexture:{[modelPath('test')]:cube({textures:{all:'block/missing'}})},missingVariable:{[modelPath('test')]:cube({textures:{}})},textureCycle:{[modelPath('test')]:cube({textures:{all:'#next',next:'#all'}})},missingFace:{[modelPath('test')]:{parent:'block/block'}},
 modelDepth:{...Object.fromEntries(Array.from({length:34},(_,i)=>[modelPath(i===0?'test':`d${i}`),{parent:i<33?`block/d${i+1}`:'block/cube_all',textures:{all:'block/a'}}]))},
 textureDepth:{[modelPath('test')]:cube({textures:{all:'#d0',...Object.fromEntries(Array.from({length:33},(_,i)=>[`d${i}`,i<32?`#d${i+1}`:'block/a']))}})} })){
 record(name,{[statePath('test')]:{variants:{'':{model:'block/test'}}},...files});
}
record('unknown-block',{},[{blockId:'minecraft:unknown',state:{}}]);
for(const [name,value]of Object.entries({null:null,mix:{variants:{},multipart:[]},emptyVariants:{variants:{}},manyVariants:{variants:Object.fromEntries(Array.from({length:513},(_,i)=>[`x=${i}`,{model:'block/a'}]))},
 unsafeVariant:{variants:{'__proto__=x':{model:'block/a'}}},duplicateCondition:{variants:{'x=1,x=2':{model:'block/a'}}},badWeight:{variants:{'':{model:'block/a',weight:0}}},badRotation:{variants:{'':{model:'block/a',x:45}}},badUvlock:{variants:{'':{model:'block/a',uvlock:null}}},
 badMultipart:{multipart:[]},mixedCondition:{multipart:[{when:{OR:[],x:'y'},apply:{model:'block/a'}}]},contradiction:{multipart:[{when:{AND:[{x:'1'},{x:'2'}]},apply:{model:'block/a'}}]},
 manyApply:{multipart:[{apply:Array.from({length:33},()=>({model:'block/a'}))}]},nullWhen:{multipart:[{when:null,apply:{model:'block/a'}}]}}))record('invalid-state-'+name,{[statePath('test')]:value});
for(const [name,value]of Object.entries({null:null,nonBlockParent:{parent:'item/a'},badDescriptor:{textures:{x:{sprite:'block/a',other:1}}},nullTextures:{textures:null},unsafeTexture:{textures:{constructor:'block/a'}},
 emptyElements:{elements:[]},manyElements:{elements:Array.from({length:65},()=>cube().elements[0])},line:{elements:[{from:[0,0,0],to:[0,0,16],faces:{up:{texture:'block/a'}}}]},
 bound:cube({elements:[{...cube().elements[0],from:[-17,0,0]}]}),badUv:cube({elements:[{...cube().elements[0],faces:{up:{texture:'block/a',uv:[0,0,17,16]}}}]}),
 badRotation:cube({elements:[{...cube().elements[0],rotation:{origin:[8,8,8],axis:'x',angle:90,rescale:true}}]}),mixedRotation:cube({elements:[{...cube().elements[0],rotation:{origin:[8,8,8],axis:'x',angle:15,x:0,y:0,z:0}}]}),
 eulerRescale:cube({elements:[{...cube().elements[0],rotation:{origin:[8,8,8],x:15,y:0,z:0,rescale:true}}]})}))record('invalid-model-'+name,{[modelPath('test')]:value,[statePath('test')]:{variants:{'':{model:'block/test'}}}});
record('invalid-paths-and-json',{'assets/BAD/blockstates/test.json':{},'assets/minecraft/models/block/UPPER.json':{},[modelPath('bad-json')]:strToU8('{broken'),[statePath('bad-utf8')]:new Uint8Array([0xff]),[statePath('non-object')]:[]});
const rotations=[];for(const face of faces)for(const x of [0,90,180,270])for(const y of [0,90,180,270])for(const uvlock of [true,false])for(const rotation of [0,90,180,270])rotations.push({face,x,y,uvlock,rotation,expected:api.resolveFaceTextureRotation(face,x,y,uvlock,rotation)});
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-resource-blocks-oracle.json'),JSON.stringify({schema:1,sourceHashes,cases,rotations}));
const archives=[];
for(const input of process.argv.slice(3)){
 const p=path.resolve(input),bytes=fs.readFileSync(p),parsed=api.parseJava16xResourcePack(bytes),result=normalized(parsed);
 // Whole normalized structures are compared directly, then exercised with actual state variants.
 const resolutions=[];
 for(const state of parsed.blockStates){
  const variants=state.variants;
  const values=state.multipart?[Object.assign({},...state.multipart.flatMap(p=>p.when.clauses).map(c=>Object.fromEntries(Object.entries(c).map(([k,v])=>[k,v[0]]))))]
   :[...new Set([0,Math.floor(variants.length/2),variants.length-1])].filter(i=>i>=0&&i<variants.length).map(i=>variants[i].conditions);
  for(const valuesAt of values){const q={blockId:state.resourceId,state:valuesAt,position:{x:19,y:64,z:-31}};resolutions.push({...q,geometry:api.resolveBlockGeometry(parsed,q.blockId,q.state,q.position),textures:api.resolveBlockTextures(parsed,q.blockId,q.state,q.position)});}
 }
 archives.push({path:p,sha256:sha(bytes),expected:result,resolutions});
}
if(archives.length)fs.writeFileSync(path.join(out,'native-resource-block-files-oracle.json'),JSON.stringify({schema:1,sourceHashes,archives}));
console.log(JSON.stringify({cases:cases.length,resolutions:cases.reduce((n,c)=>n+c.resolutions.length,0),rotations:rotations.length,archives:archives.length,sourceFiles:Object.keys(sourceHashes).length}));
