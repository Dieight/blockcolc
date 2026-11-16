import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const out=path.resolve(process.argv[2]??'');
const allowed=path.join(repo,'apps/native-android/world-core/build/generated');
assert.ok(out.startsWith(allowed+path.sep),'Only the module generated directory may receive fixtures.');
const source='apps/web/src/world-debug.ts';
const compiled=await build({entryPoints:[path.join(repo,source)],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {projectWorldDebug}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const rendererSource='packages/voxel/src/renderer.ts',renderer=fs.readFileSync(path.join(repo,rendererSource),'utf8').replace(/\r\n/g,'\n');
const from=renderer.indexOf('  function worldsWithDebugDecay('),to=renderer.indexOf('  function updateRainAnimation(',from);
assert.ok(from>=0&&to>from,'Formal condition override moved');
const conditionModule=await build({stdin:{contents:`import * as THREE from 'three';
export function conditionFor(decay){const environmentDebugOverride={decayAmount:decay};
${renderer.slice(from,to)}
return worldsWithDebugDecay([{buildingConditionBasisPoints:3123}])[0].buildingConditionBasisPoints;
}`,resolveDir:repo,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {conditionFor}=await import(`data:text/javascript;base64,${Buffer.from(conditionModule.outputFiles[0].text).toString('base64')}`);
const before=process.env.TZ;const cases=[];
try{
  for(const [zone,now] of [['Asia/Shanghai','2026-10-26T15:59:30Z'],['UTC','2026-10-26T23:59:30Z'],
    ['America/New_York','2026-03-08T06:59:30Z'],['America/New_York','2026-11-01T17:00:00Z']]){
    process.env.TZ=zone;
    for(const weather of ['normal','clear','cloudy','rain','storm','snow','mist'])for(const minutes of [null,0,90,150,720,1439])for(const enabled of [false,true]){
      const settings={enabled,weather,timeMinutes:minutes,decayAmount:null};const nowMs=Date.parse(now);
      const result=projectWorldDebug(settings,nowMs);
      cases.push({zone,now:nowMs,settings,result});
    }
  }
}finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
assert.equal(cases.length,336);
const decayCases=[];
for(const enabled of [false,true])for(const decayAmount of [null,0,.12505,.33335,.5,.99995,1]){
 const settings={enabled,weather:'normal',timeMinutes:null,decayAmount};const result=projectWorldDebug(settings,0);
 decayCases.push({settings,condition:result?.decayAmount==null?null:conditionFor(result.decayAmount)});
}
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const self=path.relative(repo,fileURLToPath(import.meta.url)).replaceAll('\\','/');
const hashes=Object.fromEntries([source,rendererSource,self,'package-lock.json'].map(file=>[file,sha(path.join(repo,file))]));
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'native-world-debug-oracle.json'),JSON.stringify({schema:1,sourceHashes:hashes,cases,decayCases}));
console.log(`Native debug oracle: ${cases.length} current formal projections, including DST gap and overlap; ${decayCases.length} renderer condition overrides.`);
