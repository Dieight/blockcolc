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
function png(width=16,height=16,seed=1){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=y*(width*4+1)+1+x*4;raw[at]=(x*seed+y)%256;raw[at+1]=(y*17+seed)%256;raw[at+2]=seed;raw[at+3]=255;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlibSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const model=(texture='a')=>({parent:'block/cube_all',textures:{all:`block/${texture}`}});
const pack=(name,files={})=>({'pack.mcmeta':json({pack:{pack_format:97,description:name}}),...Object.fromEntries(Object.entries(files).map(([p,v])=>[p,v instanceof Uint8Array?v:json(v)]))});
const fixturePack=()=>pack('base',{'assets/minecraft/textures/block/a.png':png(),
 'assets/minecraft/blockstates/test.json':{variants:{'':{model:'block/test'}}},'assets/minecraft/models/block/test.json':model(),
 'assets/minecraft/textures/entity/chest/normal.png':png(64,64),'assets/minecraft/textures/colormap/grass.png':png(256,256)});
const decoded=v=>{
 const specialTextures=(v.specialTextures??[]).map(({png,...metadata})=>({...metadata,rgbaSha256:sha(api.decodeResourcePackSpecialTexture({...metadata,png}))}));
 const colormaps=(v.colormaps??[]).map(({png,...metadata})=>({...metadata,rgbaSha256:sha(api.decodeResourcePackColormap({...metadata,png}))}));
 return {specialTextures,colormaps};
};
const normalized=v=>({pack:v.pack,textures:v.textures.map(({png,...metadata})=>({...metadata,pngSha256:sha(png)})),
 blockStates:v.blockStates,models:v.models,...decoded(v),summary:{...v.summary,issues:v.summary.issues.map(({path,code})=>({path,code}))}});
const cases=[];
function record(name,layers){const archives=layers.map(files=>zipSync(files)),parsed=archives.map(b=>api.parseJava16xResourcePack(b));
 let result=parsed[0];for(const p of parsed.slice(1))result=api.layerResourcePackManifests(result,p);
 const ids=result.blockStates.map(s=>s.resourceId),queries=ids.map(blockId=>({blockId,state:{},geometry:api.resolveBlockGeometry(result,blockId),textures:api.resolveBlockTextures(result,blockId)}));
 cases.push({name,archives:archives.map(b=>Buffer.from(b).toString('base64')),expected:normalized(result),queries});
}
record('single-base',[fixturePack()]);
record('textures-only-overlay',[fixturePack(),pack('overlay',{'assets/minecraft/textures/block/a.png':png(32,32,7)})]);
record('model-overlay-inherits-texture',[fixturePack(),pack('overlay',{'assets/minecraft/models/block/test.json':model('b'),'assets/minecraft/textures/block/b.png':png(16,16,3)})]);
record('same-path-different-owner',[fixturePack(),pack('overlay',{'assets/minecraft/textures/entity/chest/normal.png':png(64,64,21),'assets/minecraft/textures/colormap/grass.png':png(256,256,31)})]);
record('three-layers',[fixturePack(),pack('middle',{'assets/minecraft/textures/block/b.png':png(16,16,4),'assets/minecraft/models/block/test.json':model('b')}),pack('top',{'assets/minecraft/textures/block/b.png':png(16,16,9)})]);
const whitelist=['banner','chest','conduit','copper_golem','creeper','decorated_pot','end_portal','enderdragon','piglin','shulker','skeleton','zombie','player/wide','player/slim'];
record('special-whitelist',[pack('special',{...Object.fromEntries(whitelist.map(p=>[`assets/minecraft/textures/entity/${p}/test.png`,png(32,64)])),
 'assets/minecraft/textures/entity/cow/not-imported.png':png(),'assets/minecraft/textures/entity/player/not-imported.png':png(),
 'assets/INVALID/textures/entity/chest/bad.png':png(),'assets/minecraft/textures/colormap/grass.png':png(256,256),
 'assets/minecraft/textures/colormap/foliage.png':png(256,256,2),'assets/minecraft/textures/colormap/dry_foliage.png':png(256,256,3)})]);
const bad=png();bad[bad.length-1]^=127;
record('bad-special-and-colormaps',[pack('bad',{'assets/minecraft/textures/entity/chest/empty.png':new Uint8Array(),'assets/minecraft/textures/entity/chest/crc.png':bad,
 'assets/minecraft/textures/entity/chest/too-wide.png':png(1025,1),'assets/minecraft/textures/colormap/grass.png':png(16,16),
 'assets/minecraft/textures/colormap/foliage.png':bad,'assets/minecraft/textures/colormap/dry_foliage.png':new Uint8Array()})]);
record('special-count-budget',[pack('count',Object.fromEntries(Array.from({length:513},(_,i)=>[`assets/minecraft/textures/entity/chest/test${i.toString().padStart(4,'0')}.png`,png()])))]);
record('special-pixel-budget',[pack('pixels',Object.fromEntries(Array.from({length:5},(_,i)=>[`assets/minecraft/textures/entity/chest/test${i}.png`,png(1024,1024,i+1)])))]);
record('invalid-upper-asset-keeps-valid-base',[fixturePack(),pack('overlay',{'assets/minecraft/models/block/test.json':{},'assets/minecraft/textures/block/a.png':bad,
 'assets/minecraft/textures/entity/chest/normal.png':bad,'assets/minecraft/textures/colormap/grass.png':bad})]);
const paths=['chest/normal','player/wide/steve','player/slim/alex','player/wide','cow/cow','chest/../x','/chest/x','chest//x','chest/X','chest/'+ 'x'.repeat(251),'banner','banner/x'];
const allowedPaths=paths.map(path=>({path,expected:api.isAllowedSpecialTexturePath(path)}));
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-resource-stack-oracle.json'),JSON.stringify({schema:1,sourceHashes,cases,allowedPaths}));
const archives=[];let base;
for(const input of process.argv.slice(3)){const p=path.resolve(input),bytes=fs.readFileSync(p),parsed=api.parseJava16xResourcePack(bytes);
 const row={path:p,sha256:sha(bytes),expected:normalized(parsed)};
 if(!base)base=parsed;else{const stack=api.layerResourcePackManifests(base,parsed);row.layered=normalized(stack);row.queries=[];
  for(const state of stack.blockStates){const variants=state.variants,values=state.multipart?Object.assign({},...state.multipart.flatMap(p=>p.when.clauses).map(c=>Object.fromEntries(Object.entries(c).map(([k,v])=>[k,v[0]])))):variants[Math.floor(variants.length/2)]?.conditions;
   if(values){const position={x:21,y:63,z:-17};row.queries.push({blockId:state.resourceId,state:values,position,geometry:api.resolveBlockGeometry(stack,state.resourceId,values,position)});}}
 };archives.push(row);
}
if(archives.length)fs.writeFileSync(path.join(out,'native-resource-stack-files-oracle.json'),JSON.stringify({schema:1,sourceHashes,archives}));
console.log(JSON.stringify({cases:cases.length,allowedPaths:allowedPaths.length,archives:archives.length,sourceFiles:Object.keys(sourceHashes).length}));
