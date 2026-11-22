import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const out=path.resolve(process.argv[2]??'');
assert.ok(out.startsWith(path.join(repo,'apps/native-android/world-core/build/generated')+path.sep));
const bundle=buildSync({absWorkingDir:repo,stdin:{contents:`export {AnimalModels} from ${JSON.stringify(path.join(repo,'packages/voxel/src/animal-models.ts'))};`,resolveDir:repo,sourcefile:'animal-models-reference.ts'},bundle:true,platform:'node',format:'esm',metafile:true,preserveSymlinks:true,write:false});
const {AnimalModels}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const models=new AnimalModels();
const meshes=[models.parts,models.faces,models.contacts,models.ripples].map(mesh=>{
  const g=mesh.geometry,m=mesh.material,t=m.map;
  return {capacity:mesh.instanceMatrix.count,position:Array.from(g.attributes.position.array),normal:Array.from(g.attributes.normal.array),
    uv:Array.from(g.attributes.uv.array),indices:Array.from(g.index?.array??Array.from({length:g.attributes.position.count},(_,i)=>i)),
    castShadow:mesh.castShadow,receiveShadow:mesh.receiveShadow,material:{color:m.color.toArray(),emissive:m.emissive?.toArray()??[0,0,0],
      emissiveIntensity:m.emissiveIntensity??0,opacity:m.opacity,roughness:m.roughness??null,metalness:m.metalness??null,
      unlit:m.isMeshBasicMaterial===true,vertexColors:m.vertexColors,transparent:m.transparent,depthWrite:m.depthWrite,depthTest:m.depthTest,
      side:m.side,toneMapped:m.toneMapped,fog:m.fog,flipY:t?.flipY??false},
    texture:t?{pixels:Buffer.from(t.image.data).toString('base64'),width:t.image.width,height:t.image.height,colorSpace:t.colorSpace,
      generateMipmaps:t.generateMipmaps,wrapS:t.wrapS,wrapT:t.wrapT,minFilter:t.minFilter,magFilter:t.magFilter,anisotropy:t.anisotropy}:null};
});
const sourceHashes={};
for(const name of Object.keys(bundle.metafile.inputs)){
  const file=path.resolve(repo,name);if(!fs.existsSync(file))continue;
  sourceHashes[path.relative(repo,file).replaceAll('\\','/')]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
models.dispose();fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'native-animal-models-oracle.json'),JSON.stringify({schema:1,sourceHashes,meshes}));
console.log(JSON.stringify({meshes:meshes.length,sourceFiles:Object.keys(sourceHashes).length,triangles:meshes.map(m=>m.indices.length/3)}));
