import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';import {zipSync,zlibSync,strToU8} from 'fflate';
const repo=fileURLToPath(new URL('../../../',import.meta.url)),out=path.resolve(process.argv[2]??'');assert.ok(out.startsWith(path.join(repo,'apps/native-android/world-core/build/generated')+path.sep));
const bundle=buildSync({absWorkingDir:repo,entryPoints:['packages/resource-pack/src/index.ts'],bundle:true,platform:'node',format:'esm',metafile:true,write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),json=v=>strToU8(JSON.stringify(v));
const sourceHashes=Object.fromEntries(Object.keys(bundle.metafile.inputs).map(p=>[p.replaceAll('\\','/'),sha(fs.readFileSync(path.join(repo,p)))]));
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(name,b){const v=Buffer.alloc(b.length+12);v.writeUInt32BE(b.length);v.write(name,4);v.set(b,8);v.writeUInt32BE(crc(v.subarray(4,v.length-4)),v.length-4);return v;}
function png(width=16,height=width,{alpha='opaque',badAdler=false,seed=1}={}){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){let at=y*(width*4+1)+1+x*4;raw[at]=(x*17+y*seed)%256;raw[at+1]=(y*29+seed)%256;raw[at+2]=x+y;raw[at+3]=alpha==='translucent'&&x%3===0?107:alpha==='cutout'&&x%3===0?0:255;}
 const z=zlibSync(raw);if(badAdler)z[z.length-1]^=91;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',z),chunk('IEND',Buffer.alloc(0))]);}
const faces=['down','up','north','south','west','east'];
const model=(overrides={})=>({textures:{all:'block/a'},elements:[{from:[0,0,0],to:[16,16,16],faces:Object.fromEntries(faces.map((f,i)=>[f,{texture:'#all',uv:[i,1,16,15],rotation:i%4*90,tintindex:i,cullface:f}]))}],...overrides});
const pack=files=>({'pack.mcmeta':json({pack:{pack_format:97,description:'atlas oracle'}}),'assets/minecraft/blockstates/test.json':json({variants:{'':{model:'block/test'}}}),
 'assets/minecraft/models/block/test.json':json(model()),...Object.fromEntries(Object.entries(files).map(([p,v])=>[p,v instanceof Uint8Array?v:json(v)]))});
const tex=(id,w=16,h=w,options={})=>({[`assets/minecraft/textures/block/${id}.png`]:png(w,h,options)});
const normalize=atlas=>({...atlas,pages:atlas.pages.map(({rgba,...metadata})=>({...metadata,rgbaSha256:sha(rgba)}))});
function build(parsed,limits,selectedIds,duplicate){let textures=selectedIds?parsed.textures.filter(t=>selectedIds.includes(t.resourceId)):parsed.textures;if(duplicate&&textures.length)textures=[...textures,textures[0]];return api.buildJava16xTextureAtlas({textures},limits);}
const cases=[];
function record(name,files,limits={},selectedIds,duplicate=false){const bytes=zipSync(pack(files)),parsed=api.parseJava16xResourcePack(bytes);let expected,atlas;
 try{atlas=build(parsed,limits,selectedIds,duplicate);expected=normalize(atlas);}catch(e){assert.equal(e.name,'TextureAtlasError',name);expected={error:e.code,...(e.resourceId?{resourceId:e.resourceId}:{})};}
 const q={blockId:'minecraft:test',state:{}};const mapping=atlas?{geometry:api.mapBlockGeometryToAtlas(api.resolveBlockGeometry(parsed,q.blockId,q.state),atlas),textures:api.mapBlockTexturesToAtlas(api.resolveBlockTextures(parsed,q.blockId,q.state),atlas)}:undefined;
 cases.push({name,zip:Buffer.from(bytes).toString('base64'),limits,...(selectedIds?{selectedIds}:{}),duplicate,expected,...(mapping?{mapping}:{})});}
for(const size of [16,32,64,128,256])for(const alpha of ['opaque','cutout','translucent'])record(`native-${size}-${alpha}`,tex('a',size,size,{alpha}));
record('mixed-native-pages',{...tex('a'),...tex('b',32),...tex('c',64),...tex('d',128),...tex('e',256)},{maxPages:8});
record('mixed-page-budget',{...tex('a'),...tex('b',32),...tex('c',64),...tex('d',128),...tex('e',256)});
record('strip-animation',{...tex('a',16,64,{alpha:'cutout'}),'assets/minecraft/textures/block/a.png.mcmeta':{animation:{interpolate:true,frametime:3,frames:[3,{index:1,time:7},0,2]}}});
record('grid-animation',{...tex('a',32,32),'assets/minecraft/textures/block/a.png.mcmeta':{animation:{width:16,frames:[2,1,2]}}});
record('single-playback-frame',{...tex('a',16,64),'assets/minecraft/textures/block/a.png.mcmeta':{animation:{frames:[2]}}});
record('animated-and-static',{...tex('a',16,64),'assets/minecraft/textures/block/a.png.mcmeta':{animation:{}},...tex('b'),...tex('c')});
record('page-splitting',{...tex('a'),...tex('b'),...tex('c'),...tex('d')},{maxPageSize:32,maxPages:4});
record('page-count-failure',{...tex('a'),...tex('b'),...tex('c')},{maxPageSize:32,maxPages:2});
record('animation-must-stay-on-one-page',{...tex('a',16,64),'assets/minecraft/textures/block/a.png.mcmeta':{animation:{}}},{maxPageSize:32});
record('non-power-page',{...Object.assign({},...Array.from({length:16},(_,i)=>tex('a'+i)))},{maxPageSize:80});
record('gutter-one',tex('a'),{gutter:1});record('gutter-eight',tex('a'),{gutter:8});
record('budget-preserves-old-atlas',tex('a'),{maxDecodedBytes:10000,reservedAtlasBytes:9000,additionalWorkingSetBytes:1000});
record('png-byte-limit',tex('a'),{maxPngBytes:4});record('pixel-limit',tex('a'),{maxSourcePixelsPerTexture:4});
record('texture-count',{...tex('a'),...tex('b')},{maxTextures:1});
record('physical-frame-count',{...tex('a',16,64),'assets/minecraft/textures/block/a.png.mcmeta':{animation:{}}},{maxTextures:3});
for(const limits of [{maxPageSize:5000},{gutter:0},{gutter:17},{maxPages:0},{reservedAtlasBytes:-1}])record('invalid-'+JSON.stringify(limits),tex('a'),limits);
record('empty',{});record('empty-with-reserved',{}, {maxDecodedBytes:10,reservedAtlasBytes:11});
record('duplicate-id',tex('a'),{},undefined,true);
record('damaged-png-stream',tex('a',16,16,{badAdler:true}));
record('selected-ids',{...tex('a'),...tex('b',32),...tex('c',64)},{},['minecraft:block/a']);
record('missing-atlas-texture',{...tex('a'),...tex('b')},{},['minecraft:block/b']);
record('force-translucent',{...tex('a'),'assets/minecraft/models/block/test.json':model({textures:{all:{sprite:'block/a',force_translucent:true}}})});
record('out-of-range-default-uv',{...tex('a'),'assets/minecraft/models/block/test.json':model({elements:[{from:[-1,0,0],to:[16,16,16],faces:{up:{texture:'#all'}}}]})});
record('origin-outside-atlas-bound',{...tex('a'),'assets/minecraft/models/block/test.json':model({elements:[{...model().elements[0],rotation:{origin:[40,8,8],axis:'x',angle:22.5}}]})});
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-resource-atlas-oracle.json'),JSON.stringify({schema:1,sourceHashes,cases}));
const archives=[];let base;
for(const input of process.argv.slice(3)){const p=path.resolve(input),bytes=fs.readFileSync(p),current=api.parseJava16xResourcePack(bytes);const parsed=base?api.layerResourcePackManifests(base,current):current;if(!base)base=current;let expected;
 try{expected=normalize(api.buildJava16xTextureAtlas(parsed));}catch(e){assert.equal(e.name,'TextureAtlasError');expected={error:e.code,...(e.resourceId?{resourceId:e.resourceId}:{})};}
 archives.push({path:p,sha256:sha(bytes),expected});}
if(archives.length)fs.writeFileSync(path.join(out,'native-resource-atlas-files-oracle.json'),JSON.stringify({schema:1,sourceHashes,archives}));
console.log(JSON.stringify({cases:cases.length,archives:archives.length,sourceFiles:Object.keys(sourceHashes).length}));
