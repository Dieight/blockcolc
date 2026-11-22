import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';import {buildSync} from 'esbuild';import {zipSync,zlibSync,strToU8} from 'fflate';import * as THREE from 'three';
process.on('uncaughtException',error=>{console.error(String(error));console.error((error.stack??'').split('\n').filter(line=>!line.includes('data:text/javascript')).slice(1).join('\n'));process.exitCode=1;});
const repo=fileURLToPath(new URL('../../../',import.meta.url)),out=path.resolve(process.argv[2]??'');
assert.ok(out.startsWith(path.join(repo,'apps/native-android/world-core/build/generated')+path.sep));
const source=`export * from './packages/resource-pack/src/index';export * from './packages/voxel/src/visual-biome';
export {resolvePackTileRect,cropAtlasTilePixels} from './packages/voxel/src/resource-textures';export * from './packages/voxel/src/terrain-material';`;
const bundle=buildSync({absWorkingDir:repo,stdin:{contents:source,resolveDir:repo,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,metafile:true,preserveSymlinks:true});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),json=v=>strToU8(JSON.stringify(v));
const sourceHashes=Object.fromEntries(Object.keys(bundle.metafile.inputs).filter(p=>!p.startsWith('<')).map(p=>[p.replaceAll('\\','/'),sha(fs.readFileSync(path.join(repo,p)))]));
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(name,b){const v=Buffer.alloc(b.length+12);v.writeUInt32BE(b.length);v.write(name,4);v.set(b,8);v.writeUInt32BE(crc(v.subarray(4,v.length-4)),v.length-4);return v;}
function png(width,height=width,seed=1,alpha=false){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const at=y*(width*4+1)+1+x*4;raw[at]=(x*17+y*seed)%256;raw[at+1]=(y*29+seed*19)%256;raw[at+2]=(x+y+seed*47)%256;raw[at+3]=alpha&&x%3===0?107:255;
 }return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlibSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const blocks={grass:'grass_block',dirt:'dirt',stone:'stone',sand:'sand',snow:'snow_block',ice:'ice',terracotta:'terracotta'};
const faces=['down','up','north','south','west','east'];
function pack(size=16,tint=0){
 const files={'pack.mcmeta':json({pack:{pack_format:97,description:'Independent terrain source oracle'}})};
 for(const[name,index]of Object.entries(blocks).map(([key,value],i)=>[value,i])){
  files[`assets/minecraft/textures/block/${name}.png`]=png(size,size,index+1,name==='ice');
  files[`assets/minecraft/blockstates/${name}.json`]=json({variants:{'':{model:`block/${name}`}}});
  files[`assets/minecraft/models/block/${name}.json`]=json({textures:{all:`block/${name}`},elements:[{from:[0,0,0],to:[16,16,16],
   faces:Object.fromEntries(faces.map(f=>[f,{texture:'#all',...(name==='grass_block'&&tint!==null?{tintindex:tint}:{}),uv:[1,2,14,15],rotation:90}]))}]});
 }return files;
}
const raw=[];for(const size of [16,32,64,128,256])raw.push({name:`size-${size}`,files:pack(size)});
raw.push({name:'no-tint',files:pack(16,null)},{name:'non-grass-tint',files:pack(16,1)});
const conditions=pack();conditions['assets/minecraft/blockstates/grass_block.json']=json({variants:{'snowy=false':{model:'block/grass_block'},'snowy=true':{model:'block/stone'}}});raw.push({name:'first-variant',files:conditions});
const animated=pack();animated['assets/minecraft/textures/block/grass_block.png']=png(16,64,9);
animated['assets/minecraft/textures/block/grass_block.png.mcmeta']=json({animation:{frames:[2,0,3],frametime:4,interpolate:true}});raw.push({name:'first-playback-frame',files:animated});
const missing=pack();delete missing['assets/minecraft/textures/block/sand.png'];raw.push({name:'partial-missing-texture',files:missing});
const colormap=pack();colormap['assets/minecraft/textures/colormap/grass.png']=png(256,256,17);raw.push({name:'colormap',files:colormap});
raw.push({name:'empty',files:{'pack.mcmeta':json({pack:{pack_format:97,description:'No terrain assets'}})}});
raw.push({name:'terrain-gallery',files:pack()});
const cases=raw.map(({name,files})=>{
 const bytes=zipSync(files),parsed=api.parseJava16xResourcePack(bytes),atlas=api.buildJava16xTextureAtlas(parsed);
 const palette=api.createVisualBiomePalette((parsed.colormaps??[]).map(c=>({...c,rgba:api.decodeResourcePackColormap(c)})));
 const expected={};for(const[kind,name]of Object.entries(blocks)){
  const blockId=`minecraft:${name}`,rect=api.resolvePackTileRect(parsed,{source:atlas,pages:atlas.pages},blockId,'up');if(!rect)continue;
  const page=atlas.pages[rect.page],crop=api.cropAtlasTilePixels(page.rgba,page.width,page.height,rect),color=api.terrainTileColor(blockId,rect.tintIndex,palette);
  const texture=new THREE.Texture();api.configureTerrainTile(texture,16);
  expected[kind]={blockId,width:crop.width,height:crop.height,rgbaSha256:sha(crop.pixels),color,
   rgb:new THREE.Color(color).toArray().map(Math.fround),sideRgb:new THREE.Color(color).multiplyScalar(api.TERRAIN_SIDE_SHADE).toArray().map(Math.fround),
   generateMipmaps:texture.generateMipmaps,minFilter:texture.minFilter,magFilter:texture.magFilter,anisotropy:texture.anisotropy};texture.dispose();
 }return {name,zip:Buffer.from(bytes).toString('base64'),palette,expected};
});
assert.equal(cases.length,13);fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'native-resource-terrain-oracle.json'),JSON.stringify({schema:1,sourceHashes,cases}));
console.log(JSON.stringify({cases:cases.length,tiles:cases.reduce((n,c)=>n+Object.keys(c.expected).length,0),sourceFiles:Object.keys(sourceHashes).length}));
