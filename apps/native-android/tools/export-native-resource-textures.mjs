import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {zipSync,zlibSync,strToU8} from 'fflate';
const repo=fileURLToPath(new URL('../../../',import.meta.url)),out=path.resolve(process.argv[2]??'');
assert.ok(out.startsWith(path.join(repo,'apps/native-android/world-core/build/generated')+path.sep));
const entry=path.join(repo,'packages/resource-pack/src/index.ts');
const bundle=buildSync({absWorkingDir:repo,stdin:{contents:fs.readFileSync(entry,'utf8')+'\nexport {normalizeTextureAnimation};',resolveDir:path.dirname(entry),sourcefile:entry,loader:'ts'},bundle:true,platform:'node',format:'esm',metafile:true,preserveSymlinks:true,write:false});
const {decodePngRgba,inspectPngDimensions,normalizeTextureAnimation,parseJava16xResourcePack}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),b64=bytes=>Buffer.from(bytes).toString('base64');
const json=v=>strToU8(JSON.stringify(v));
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(name,data){const result=new Uint8Array(data.length+12),v=new DataView(result.buffer);v.setUint32(0,data.length);result.set(strToU8(name),4);result.set(data,8);v.setUint32(data.length+8,crc(result.subarray(4,data.length+8)));return result;}
const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
function png({width=9,height=7,color=6,depth=8,filter=0,split=false,interlace=0,extra,checksum=false,rowDelta=0,paletteBad=false,alphaHigh=false}={}){
 const channels=({6:4,4:2,2:3})[color]??1,bits=channels*depth,rowBytes=Math.ceil(width*bits/8),bpp=Math.max(1,Math.ceil(bits/8));
 const raw=new Uint8Array((rowBytes+1)*height+Math.max(0,rowDelta));let previous=new Uint8Array(rowBytes),first;
 const palette=Uint8Array.from({length:Math.min(1<<depth,256)*3},(_,i)=>(i*51+17)%256);
 for(let y=0;y<height;y++){const row=new Uint8Array(rowBytes);for(let x=0;x<width;x++){
  if(depth<8){const bit=x*depth,rowIndex=Math.floor(bit/8),shift=8-depth-bit%8;row[rowIndex]|=((x+y*3)%Math.min(1<<depth,256))<<shift;}
  else for(let c=0;c<channels;c++)row[x*channels+c]=color===3?(x+y*3)%Math.min(1<<depth,256):(x*31+y*17+c*29)%256;
 }
 if(y===0)first=row;const start=y*(rowBytes+1);raw[start]=filter;
 for(let x=0;x<rowBytes;x++){const left=x>=bpp?row[x-bpp]:0,up=y>0?previous[x]:0,corner=y>0&&x>=bpp?previous[x-bpp]:0;
  const p=left+up-corner,a=Math.abs(p-left),b=Math.abs(p-up),c=Math.abs(p-corner),paeth=a<=b&&a<=c?left:b<=c?up:corner;
  const prediction=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth;raw[start+1+x]=(row[x]-prediction)&255;
 };previous=row;}
 const header=new Uint8Array(13),hv=new DataView(header.buffer);hv.setUint32(0,width);hv.setUint32(4,height);header[8]=depth;header[9]=color;header[12]=interlace;
 const compressed=zlibSync(rowDelta<0?raw.subarray(0,raw.length+rowDelta):raw);if(checksum)compressed[compressed.length-1]^=127;
 const middle=[];if(color===3){middle.push(chunk('PLTE',paletteBad?palette.subarray(0,1):palette));middle.push(chunk('tRNS',new Uint8Array([255,37,170])));}
 if(color===2)middle.push(chunk('tRNS',new Uint8Array([0,first[0],0,first[1],0,first[2]])));
 if(color===0)middle.push(chunk('tRNS',new Uint8Array([alphaHigh?1:0,0])));
 if(extra)middle.push(chunk('tEXt',strToU8('source ancillary')));
 const idat=split?[chunk('IDAT',new Uint8Array()),chunk('IDAT',compressed.subarray(0,3)),chunk('IDAT',compressed.subarray(3,11)),chunk('IDAT',compressed.subarray(11))]:[chunk('IDAT',compressed)];
 return concat(new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...middle,...idat,chunk('IEND',new Uint8Array()));
}
const pngCases=[];function imageCase(name,bytes){let expected;try{const v=decodePngRgba(bytes);expected={width:v.width,height:v.height,rgba:b64(v.rgba)};}catch{expected={error:true};}
 pngCases.push({name,png:b64(bytes),inspection:inspectPngDimensions(bytes)??null,expected});}
for(const color of [6,4,2])for(let filter=0;filter<=4;filter++)imageCase(`color-${color}-filter-${filter}`,png({color,filter,split:filter===4,extra:true}));
for(const color of [0,3])for(const depth of [1,2,4,8])for(const filter of [0,4])imageCase(`color-${color}-bits-${depth}-filter-${filter}`,png({color,depth,filter,split:true}));
imageCase('gray-transparency-high-byte',png({color:0,alphaHigh:true}));
for(const [name,options]of Object.entries({unsupported16:{color:0,depth:16},interlaced:{interlace:1},badChecksum:{checksum:true},badFilter:{filter:5},shortRows:{rowDelta:-1},longRows:{rowDelta:1},badPalette:{color:3,paletteBad:true}}))imageCase(name,png(options));
const crcBad=png();crcBad[crcBad.length-1]^=127;imageCase('invalid-crc',crcBad);imageCase('trailing-bytes',concat(png(),new Uint8Array([0])));imageCase('missing-end',png().subarray(0,png().length-12));
const animationCases=[];function animationCase(name,metadata,width,height){let expected;try{expected={animation:normalizeTextureAnimation(metadata,width,height)??null};}catch{expected={error:true};}animationCases.push({name,metadata:metadata??null,width,height,expected});}
animationCase('static',undefined,16,16);animationCase('strip',{animation:{}},16,64);animationCase('grid',{animation:{width:32,frametime:3,interpolate:true,frames:[1,{index:3,time:7},0]}},64,64);
animationCase('null-defaults',{animation:{width:null,height:16,frametime:null,frames:[{index:1,time:null}]}},16,32);
for(const [name,animation,width,height]of [
 ['bad-type',null,16,16],['bad-size',{width:24},48,48],['incomplete',{width:32},48,64],['rectangle',{width:16,height:32},16,32],
 ['too-many-source',{},16,4112],['empty-frames',{frames:[]},16,16],['bad-index',{frames:[1]},16,16],['fraction-index',{frames:[.5]},16,16],
 ['zero-time',{frametime:0},16,16],['long-time',{frametime:1000001},16,16],['invalid-interpolate',{interpolate:null},16,16],['null-frames',{frames:null},16,16]
])animationCase(name,{animation},width,height);
const textureCodes=new Set(['INVALID_NAMESPACE','INVALID_RESOURCE_PATH','INVALID_PNG','NOT_16X16','INVALID_TEXTURE_MCMETA','INVALID_TEXTURE_ANIMATION','ANIMATION_INTERPOLATION_DEGRADED','ORPHAN_TEXTURE_MCMETA']);
const cleanTexture=t=>{const {png,...rest}=t;return rest;};
const packFiles=files=>({'pack.mcmeta':json({pack:{min_format:[97,1],max_format:97,description:'Textures'}}),...files});
const catalogCases=[];function catalogCase(name,files){const bytes=zipSync(packFiles(files));const result=parseJava16xResourcePack(bytes);
 catalogCases.push({name,zip:b64(bytes),expected:{textures:result.textures.map(cleanTexture),candidateTextureCount:result.summary.candidateTextureCount,issues:result.summary.issues.filter(i=>textureCodes.has(i.code)).map(({path,code})=>({path,code}))}});}
const all={};for(const size of [16,32,64,128,256])all[`assets/minecraft/textures/block/static_${size}.png`]=png({width:size,height:size});
all['assets/minecraft/textures/block/water.png']=png({width:32,height:64});all['assets/minecraft/textures/block/water.png.mcmeta']=json({animation:{frametime:2,interpolate:true,frames:[1,0,{index:1,time:7}]}});
all['assets/minecraft/textures/block/grid.png']=png({width:64,height:64});all['assets/minecraft/textures/block/grid.png.mcmeta']=json({animation:{width:32}});catalogCase('all-sizes-strip-grid',all);
catalogCase('bad-and-orphan',{
 'assets/minecraft/textures/block/bad.png':crcBad,'assets/minecraft/textures/block/bad.png.mcmeta':json({animation:{}}),
 'assets/minecraft/textures/block/valid.png':png({width:16,height:16}),'assets/minecraft/textures/block/valid.png.mcmeta':strToU8('{oops'),
 'assets/minecraft/textures/block/strip.png':png({width:16,height:32}),'assets/minecraft/textures/block/small.png':png({width:8,height:8}),
 'assets/Invalid/textures/block/stone.png':png({width:16,height:16}),'assets/minecraft/textures/block/bad name.png':png({width:16,height:16}),
 'assets/minecraft/textures/block/orphan.png.mcmeta':json({animation:{}})
});
catalogCase('animation-fallback',{
 'assets/minecraft/textures/block/square.png':png({width:16,height:16}),'assets/minecraft/textures/block/square.png.mcmeta':json({animation:{frames:[2]}}),
 'assets/minecraft/textures/block/strip.png':png({width:16,height:32}),'assets/minecraft/textures/block/strip.png.mcmeta':json({animation:{frames:[3]}})
});
const sourceHashes={};for(const name of Object.keys(bundle.metafile.inputs)){const f=path.resolve(repo,name);if(fs.existsSync(f))sourceHashes[path.relative(repo,f).replaceAll('\\','/')]=sha(fs.readFileSync(f));}sourceHashes[path.relative(repo,entry).replaceAll('\\','/')]=sha(fs.readFileSync(entry));
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-resource-textures-oracle.json'),JSON.stringify({schema:1,sourceHashes,pngCases,animationCases,catalogCases}));
console.log(JSON.stringify({pngCases:pngCases.length,animationCases:animationCases.length,catalogCases:catalogCases.length,sourceFiles:Object.keys(sourceHashes).length}));
if(process.argv.length>3){const archives=[];for(const name of process.argv.slice(3)){
 const file=path.resolve(name),bytes=fs.readFileSync(file),result=parseJava16xResourcePack(bytes);
 const textures=result.textures.map(texture=>{const entry={...cleanTexture(texture)};try{const pixels=decodePngRgba(texture.png);entry.rgbaSha256=sha(pixels.rgba);}catch{entry.decodeError=true;}return entry;});
 archives.push({path:file,sha256:sha(bytes),textures,candidateTextureCount:result.summary.candidateTextureCount,issues:result.summary.issues.filter(i=>textureCodes.has(i.code)).map(({path,code})=>({path,code}))});
}fs.writeFileSync(path.join(out,'native-resource-texture-files-oracle.json'),JSON.stringify({schema:1,sourceHashes,archives}));console.log(JSON.stringify({external:archives.map(a=>({name:path.basename(a.path),textures:a.textures.length,issues:a.issues.length}))}));}
