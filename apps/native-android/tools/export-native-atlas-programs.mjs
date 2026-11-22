import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';import {buildSync} from 'esbuild';
const repo=fileURLToPath(new URL('../../../',import.meta.url)),out=path.resolve(process.argv[2]??'');assert.ok(out.startsWith(path.join(repo,'apps/native-android/world-core/build/generated')+path.sep));
const entry=path.join(repo,'packages/voxel/src/resource-textures.ts');
const bundle=buildSync({absWorkingDir:repo,stdin:{contents:fs.readFileSync(entry,'utf8')+'\nexport {createAtlasAnimationLookup};export {sampleAtlasAnimation} from "./atlas-animation";',resolveDir:path.dirname(entry),sourcefile:entry,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,metafile:true,preserveSymlinks:true});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const coreBundle=buildSync({absWorkingDir:repo,entryPoints:['packages/resource-pack/src/index.ts'],bundle:true,platform:'node',format:'esm',write:false,metafile:true,preserveSymlinks:true});
const core=await import('data:text/javascript;base64,'+Buffer.from(coreBundle.outputFiles[0].text).toString('base64'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceHashes=Object.fromEntries([...new Set([...Object.keys(bundle.metafile.inputs),...Object.keys(coreBundle.metafile.inputs)])].filter(p=>!p.startsWith('<')).map(p=>{
 const absolute=path.isAbsolute(p)?p:path.join(repo,p);return [path.relative(repo,absolute).replaceAll('\\','/'),sha(fs.readFileSync(absolute))];}));
sourceHashes['packages/voxel/src/resource-textures.ts']=sha(fs.readFileSync(entry));
const input=path.join(repo,'apps/native-android/world-core/build/generated/native-resource-atlas-oracle/native-resource-atlas-oracle.json');const atlasOracle=JSON.parse(fs.readFileSync(input,'utf8'));
for(const [p,h]of Object.entries(atlasOracle.sourceHashes))assert.equal(sha(fs.readFileSync(path.join(repo,p))),h);
const times=[0,1,25,50,75,99,100,149,150,500,1499,9000,12345];const cases=[];
for(const row of atlasOracle.cases){if(row.expected.error)continue;
 const parsed=core.parseJava16xResourcePack(Buffer.from(row.zip,'base64'));let textures=parsed.textures;if(row.selectedIds)textures=textures.filter(t=>row.selectedIds.includes(t.resourceId));
 const atlas=core.buildJava16xTextureAtlas({textures},row.limits);const pages=[];
 for(const page of atlas.pages){const levels=api.createSafeAtlasMipmaps(page.rgba,page.width,page.height,atlas.safeMipLevels).map(level=>({width:level.width,height:level.height,sha256:sha(level.data)}));
  const lookup=api.createAtlasAnimationLookup(atlas,page.index,2048);let animation;
  if(lookup){const samples=times.map(time=>{api.sampleAtlasAnimation(lookup,time);return {time,frames:sha(lookup.pixels),blends:sha(lookup.blendPixels)};});
   api.sampleAtlasAnimation(lookup,9999,true);const frozen={frames:sha(lookup.pixels),blends:sha(lookup.blendPixels)};
   const code=`${page.index}/${lookup.width}/${lookup.height}/${lookup.tileCount};`+lookup.sequences.map(s=>`${s.textureIndex}:${s.totalTicks}:${s.interpolate?1:0}:`+s.frames.map(f=>`${f.textureIndex},${f.time}`).join('/')).join(';');
   animation={identity:sha(Buffer.from(code)),width:lookup.width,height:lookup.height,tileCount:lookup.tileCount,sequences:lookup.sequences,samples,frozen};lookup.texture.dispose();lookup.blendTexture.dispose();}
  pages.push({page:page.index,levels,...(animation?{animation}:{})});
 };cases.push({name:row.name,zip:row.zip,limits:row.limits,...(row.selectedIds?{selectedIds:row.selectedIds}:{}),pages});
}
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-atlas-programs-oracle.json'),JSON.stringify({schema:1,sourceHashes,atlasOracleSha256:sha(fs.readFileSync(input)),cases}));
console.log(JSON.stringify({cases:cases.length,pages:cases.reduce((n,c)=>n+c.pages.length,0),sourceFiles:Object.keys(sourceHashes).length}));
