import {readFile,readdir,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {unzipSync} from 'fflate';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const [output,inputDirectory,deviceDirectory]=process.argv.slice(2);
if(!output||!inputDirectory)throw Error('New evidence directory and frozen world-input directory required');
await mkdir(output,{recursive:false});
const apk=path.join(root,'apps/native-android/app/build/outputs/apk/debug/app-debug.apk');
const apkBytes=await readFile(apk),sha=b=>createHash('sha256').update(b).digest('hex');
const inventory=[];
const files=unzipSync(apkBytes,{filter:entry=>{
  inventory.push({path:entry.name,bytes:entry.originalSize});return entry.name.startsWith('lib/')&&entry.name.endsWith('.so')||entry.name.endsWith('.world.json')||entry.name==='assets/compiler.json';
}});
const nativeLibraries=[];
for(const [name,bytes]of Object.entries(files).filter(([name])=>name.endsWith('.so'))) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),is64=bytes[4]===2;
  if(bytes[5]!==1)throw Error('Unexpected ELF endian');
  const offset=is64?Number(view.getBigUint64(32,true)):view.getUint32(28,true);
  const size=view.getUint16(is64?54:42,true),count=view.getUint16(is64?56:44,true),alignment=[];
  for(let i=0;i<count;i++)if(view.getUint32(offset+i*size,true)===1)
    alignment.push(is64?Number(view.getBigUint64(offset+i*size+48,true)):view.getUint32(offset+i*size+28,true));
  nativeLibraries.push({path:name,bytes:bytes.length,sha256:sha(bytes),alignment,elf16kAligned:alignment.every(n=>n>=16384)});
}
if(inventory.some(f=>f.path.endsWith('.glb')))throw Error('Frozen GLB unexpectedly packaged');
const producer=JSON.parse(await readFile(path.join(inputDirectory,'manifest.json'),'utf8'));
const fixtures=producer.reports?.map(row=>row.name);
if(producer.inventoryOnly||producer.errors?.length||
  ![JSON.stringify(['ocean','coast']),JSON.stringify(['ocean','coast','valley','floating'])].includes(JSON.stringify(fixtures)))
  throw Error('Checkpoint needs complete, bounded frozen fixtures, not source inventory only');
for(const name of fixtures.flatMap(name=>[name,name+'-update'])) {
  const expected=await readFile(path.join(inputDirectory,name+'.world.json'));
  if(sha(expected)!==sha(files['assets/'+name+'.world.json']))throw Error('APK input differs: '+name);
}
const compiler=JSON.parse(Buffer.from(files['assets/compiler.json']).toString('utf8'));
if(compiler.version!=='56')throw Error('Unexpected compiler version');
const device=deviceDirectory?JSON.parse(await readFile(path.join(deviceDirectory,'report.json'),'utf8')):null;
if(device&&(!device.ownerGpuChecksPassed||!device.nonblankUpdateAndOrbitPassed||!device.cases.every(row=>row.cleanRetirement)||device.apkSha256!==sha(apkBytes)))throw Error('Device report does not verify this APK');
const source=[];
async function walk(relative) {
  for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})) {
    if(['build','.gradle','node_modules'].includes(entry.name))continue;
    const name=relative+'/'+entry.name;
    if(entry.isDirectory())await walk(name);
    else if(entry.isFile()){const bytes=await readFile(path.join(root,name));source.push({path:name,bytes:bytes.length,sha256:sha(bytes)});}
  }
}
await walk('apps/native-android');source.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const testDir=path.join(root,'apps/native-android/world-core/build/test-results/test');
let tests=0,failures=0,errors=0,skipped=0;
for(const name of await readdir(testDir))if(name.endsWith('.xml')) {
  const xml=await readFile(path.join(testDir,name),'utf8');
  for(const [key,add]of [['tests',n=>tests+=n],['failures',n=>failures+=n],['errors',n=>errors+=n],['skipped',n=>skipped+=n]]) {
    const match=xml.match(new RegExp('<testsuite\\b[^>]*\\b'+key+'="(\\d+)"'));
    if(!match)throw Error('Missing JUnit field '+name+':'+key);add(Number(match[1]));
  }
}
if(tests<13||failures||errors||skipped)throw Error('Core regression not complete');
await copyFile(apk,path.join(output,'blockcolc-native-p1-foundation.apk'));
const report={kind:'native-p1-owner-checkpoint',executedAt:new Date().toISOString(),package:'com.blockcolc.preview',
  scope:'Bounded native preview checkpoint: exact APK, source/input/compiler identities, current JVM results and optional owner-device evidence. NOT automatic P1 approval, whole-App performance, visual parity or release.',
  p1GatePassed:false,p2Started:false,formalDataRead:false,formalAppChanged:false,
  apk:{bytes:apkBytes.length,sha256:sha(apkBytes)},jvm:{tests,failures,errors,skipped},nativeLibraries,inventory,source,
  inputDirectory,fixtures,producerFingerprint:producer.producerFingerprint,compiler,deviceDirectory:deviceDirectory??null,ownerGpuChecksPassed:device?.ownerGpuChecksPassed??false,
  gaps:['stage-level P1 audit is not performed by this archiver','matched actual presentation and complete process memory need their own reports','controlled MC resource-pack coverage needs separate evidence']};
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({apk:report.apk,jvm:report.jvm,allNativeElf16kAligned:nativeLibraries.every(x=>x.elf16kAligned),p1GatePassed:false}));
