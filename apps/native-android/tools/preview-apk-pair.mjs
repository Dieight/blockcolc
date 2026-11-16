import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {apkIdentity,assertDiagnosticApk} from './native-apk-identity.mjs';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const benchmark=process.argv.includes('--benchmark');
assert.ok(!benchmark||!process.argv.includes('--user-preview'),'Choose either benchmark or user preview');
const user=process.argv.includes('--user-preview')||benchmark;
const receiptPath=path.join(repo,'apps/native-android/app/build/outputs/'+(benchmark?'p3-benchmark-preview.json':user?'p3-user-preview.json':'p3-diagnostic-pair.json'));
const apks=benchmark?['apps/native-android/app/build/outputs/apk/benchmark/app-benchmark.apk']:user?['apps/native-android/app/build/outputs/apk/release/app-release.apk']:['apps/native-android/app/build/outputs/apk/debug/app-debug.apk','apps/native-android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'];
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,p))).digest('hex');
function walk(relative){
 const directory=path.join(repo,relative);if(!fs.existsSync(directory))return [];
 return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  if(['build','.gradle','.idea','node_modules','.git'].includes(entry.name))return [];
  const child=path.posix.join(relative,entry.name);return entry.isDirectory()?walk(child):(['baseline-prof.txt','startup-prof.txt'].includes(entry.name)||/\.(kt|java|mjs|ps1|mat|xml|gradle|json|ts|tsx|png|ttf|otf|ogg|opus|wav|mp3|m4a|flac|pem|pro|properties|in)$/.test(entry.name))?[child]:[];
 });
}
const sources=[...new Set(['apps/native-android','packages','apps/android/android/app/src/main/java','apps/android/android/app/src/main/res','apps/web/src','apps/web/public/audio','apps/web/public/fonts','apps/web/public/brand'].flatMap(walk))].sort();
try{
 const config=apkIdentity(path.join(repo,apks[0])).identity;
 assert.equal(config.mode,user?'user-preview':'diagnostic','Build configuration does not match the requested artifact receipt');
 if(!user)assertDiagnosticApk(path.join(repo,apks[0]));
 if(process.argv.includes('--record')){
  // Invoked by assembleP3DebugPair after both APK packaging tasks. This is
  // disposable build metadata; frozen device evidence retains its own pair.
  const receipt={schema:2,configuration:config,recordedAt:new Date().toISOString(),sources:Object.fromEntries(sources.map(p=>[p,sha(p)])),apks:Object.fromEntries(apks.map(p=>[p,sha(p)]))};
  fs.mkdirSync(path.dirname(receiptPath),{recursive:true});fs.writeFileSync(receiptPath+'.new',JSON.stringify(receipt,null,2));fs.renameSync(receiptPath+'.new',receiptPath);
 }
 assert.ok(fs.existsSync(receiptPath),'Build the current main/test pair with :app:assembleP3DebugPair before a device run.');
 const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));assert.equal(receipt.schema,2);assert.deepEqual(receipt.configuration,config);
 assert.deepEqual(Object.keys(receipt.sources),sources,'Native/reference source inventory changed; rebuild the pair.');
 for(const p of sources)assert.equal(sha(p),receipt.sources[p],`Source changed after the pair build: ${p}`);
 for(const p of apks)assert.equal(sha(p),receipt.apks[p],`APK no longer belongs to the recorded pair: ${p}`);
 console.log(JSON.stringify({pairVerified:!user,userPreviewVerified:user&&!benchmark,benchmarkPreviewVerified:benchmark,configuration:config,sources:sources.length,apks:receipt.apks}));
}catch(error){console.error(error.message);process.exitCode=1;}
