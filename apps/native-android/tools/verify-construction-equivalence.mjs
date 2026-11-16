import {readdir,readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import assert from 'node:assert/strict';
import {canonicalAtlasActivity} from './construction-equivalence.mjs';
const [gpu,cpu,output]=process.argv.slice(2);if(!gpu||!cpu||!output)throw Error('GPU partial, complete CPU corpus, new report required');
const names=(await readdir(path.join(gpu,'construction'))).filter(n=>n.endsWith('.p2pack'));
const result={scope:'Previously exported GPU-prepared owner packets versus CPU-only production builder output; not image or performance equivalence',cases:[],completed:false};
try{
 for(const name of names){
   const a=JSON.parse(gunzipSync(await readFile(path.join(gpu,'construction',name))));
   const b=JSON.parse(gunzipSync(await readFile(path.join(cpu,'construction',name))));
   assert.equal(b.bytes,a.bytes,'binary '+name);assert.equal(b.animals,a.animals,'collision '+name);
   for(const field of ['geometries','materials','programs','packets','textures'])assert.deepEqual(b.metadata[field],a.metadata[field],field+' '+name);
   assert.deepEqual(canonicalAtlasActivity(b.metadata.atlasAnimations),canonicalAtlasActivity(a.metadata.atlasAnimations),'atlasAnimations '+name);
   result.cases.push(name);
 }
 result.completed=true;
}catch(error){result.failure=String(error);process.exitCode=1;}
await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify({completed:result.completed,cases:result.cases.length,failure:result.failure}));
