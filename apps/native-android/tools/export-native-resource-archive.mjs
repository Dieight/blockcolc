import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {zipSync,strToU8} from 'fflate';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const out=path.resolve(process.argv[2]??'');
assert.ok(out.startsWith(path.join(repo,'apps/native-android/world-core/build/generated')+path.sep));
const entry=path.join(repo,'packages/resource-pack/src/index.ts');
const bundle=buildSync({absWorkingDir:repo,stdin:{contents:fs.readFileSync(entry,'utf8')+'\nexport {extractResourceArchive};',resolveDir:path.dirname(entry),sourcefile:entry,loader:'ts'},bundle:true,platform:'node',format:'esm',metafile:true,preserveSymlinks:true,write:false});
const {extractResourceArchive,DEFAULT_RESOURCE_PACK_LIMITS}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=v=>strToU8(JSON.stringify(v));
const base=()=>({'pack.mcmeta':json({pack:{pack_format:97,description:'资源测试 / source'}}),'assets/minecraft/blockstates/stone.json':json({variants:{'':{model:'block/stone'}}}),'assets/minecraft/textures/block/stone.png':Uint8Array.from([1,2,3,4])});
const cases=[];
function record(name,files,{level=6,limits={},mutate}={}){
 let bytes=zipSync(files,{level});if(mutate)bytes=mutate(bytes);
 let expected;try{const v=extractResourceArchive(bytes,{...DEFAULT_RESOURCE_PACK_LIMITS,...limits});expected={pack:v.pack,archiveFileCount:v.archiveFileCount,files:v.paths.map(p=>({path:p,size:v.files[p].length,sha256:sha(v.files[p])}))};}
 catch(error){assert.equal(error.name,'ResourcePackError',name);expected={error:error.code};}
 cases.push({name,zip:Buffer.from(bytes).toString('base64'),limits,expected});
}
record('legacy-compressed',base());record('legacy-stored',base(),{level:0});
record('directories-and-empty',{'assets/':new Uint8Array(),'assets/minecraft/':new Uint8Array(),...base(),'empty.txt':new Uint8Array()});
for(const [name,pack]of Object.entries({modern:{min_format:[97,1],max_format:97,description:{text:'现代'}},mixed:{pack_format:64,min_format:64,max_format:[97,1],description:['a',{text:'b'}]},nullDescription:{pack_format:97,description:null}}))record(name,{...base(),'pack.mcmeta':json({pack})});
record('overlay-priority',{
 ...base(),'pack.mcmeta':json({pack:{min_format:[97,1],max_format:97,description:'overlay'},overlays:{entries:[{directory:'old',formats:[96,98]},{directory:'future',min_format:98,max_format:98},{directory:'last',formats:{min_inclusive:97,max_inclusive:98},min_format:[97,1],max_format:[97,1]}]}}),
 'overlays/old/assets/minecraft/blockstates/stone.json':json({value:'old'}),'overlays/future/assets/minecraft/blockstates/stone.json':json({value:'future'}),
 'overlays/last/assets/minecraft/blockstates/stone.json':json({value:'last'}),'overlays/last/assets/minecraft/textures/block/new.png':new Uint8Array([12,13]),
 'overlays/last/pack.mcmeta':strToU8('ignored'),'overlays/last/pack.png':strToU8('ignored'),'overlays/unlisted/assets/minecraft/textures/block/stone.png':new Uint8Array([99])
});
const jar=()=>({'version.json':json({id:'26.3',pack_version:{resource_major:97,resource_minor:1}}),'assets/minecraft/blockstates/stone.json':json({variants:{'':{model:'block/stone'}}}),'assets/minecraft/textures/block/stone.png':new Uint8Array([9,8,7]),'com/mojang/ignore.class':new Uint8Array(8192)});
record('java-26.3-assets-only',jar(),{limits:{maxSingleFileBytes:1024}});
record('jar-wrong-version',{...jar(),'version.json':json({id:'26.2',pack_version:{resource_major:97,resource_minor:1}})});
record('jar-wrong-minor',{...jar(),'version.json':json({id:'26.3',pack_version:{resource_major:97,resource_minor:2}})});
record('jar-no-blockstates',{'version.json':jar()['version.json'],'assets/minecraft/textures/block/stone.png':new Uint8Array([1])});
record('missing-root',{'folder/pack.mcmeta':base()['pack.mcmeta']});
record('invalid-metadata',{...base(),'pack.mcmeta':strToU8('{oops')});
for(const [name,pack]of Object.entries({missingDescription:{pack_format:97},missingRangeEnd:{min_format:97,description:''},invertedRange:{min_format:[97,2],max_format:[97,1],description:''},oldRangeWithoutLegacy:{min_format:64,max_format:97,description:''},zeroFormat:{pack_format:0,description:''}}))record(name,{...base(),'pack.mcmeta':json({pack})});
for(const [name,entries]of Object.entries({duplicateOverlay:[{directory:'same',formats:97},{directory:'same',formats:97}],unsafeOverlay:[{directory:'../bad',formats:97}],invertedOverlay:[{directory:'bad',formats:[98,97]}],missingOverlayBound:[{directory:'bad',min_format:97}]}))record(name,{...base(),'pack.mcmeta':json({pack:{pack_format:97,description:''},overlays:{entries}})});
for(const pathName of ['../bad','/absolute','C:/drive','assets//bad','assets/./bad','assets/../bad','assets\\bad','assets/\0bad'])record('unsafe:'+pathName,{...base(),[pathName]:new Uint8Array([1])});
record('case-collision',{...base(),'Assets/minecraft/blockstates/stone.json':new Uint8Array()});
record('file-budget',base(),{limits:{maxSingleFileBytes:16}});record('count-budget',base(),{limits:{maxFileCount:2}});record('total-budget',base(),{limits:{maxTotalUncompressedBytes:48}});
record('metadata-budget',base(),{limits:{maxPackMetadataBytes:8}});record('input-budget',base(),{limits:{maxInputBytes:32}});
function central(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let i=bytes.length-22;i>=0;i--)if(v.getUint32(i,true)===0x06054b50)return v.getUint32(i+16,true);throw Error('No central');}
for(const [name,change]of Object.entries({encrypted:(v,c)=>v.setUint16(c+8,1,true),compression:(v,c)=>v.setUint16(c+10,12,true),zip64:(v,c)=>v.setUint32(c+24,0xffffffff,true)}))record(name,base(),{mutate:b=>{const x=b.slice(),v=new DataView(x.buffer);change(v,central(x));return x;}});
const sourceHashes={};for(const name of Object.keys(bundle.metafile.inputs)){const file=path.resolve(repo,name);if(fs.existsSync(file))sourceHashes[path.relative(repo,file).replaceAll('\\','/')]=sha(fs.readFileSync(file));}
sourceHashes[path.relative(repo,entry).replaceAll('\\','/')]=sha(fs.readFileSync(entry));
const result={schema:1,sourceHashes,cases};fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-resource-archive-oracle.json'),JSON.stringify(result));
console.log(JSON.stringify({cases:cases.length,valid:cases.filter(c=>!c.expected.error).length,sourceFiles:Object.keys(sourceHashes).length}));
if(process.argv.length>3){
 const archives=[];
 for(const name of process.argv.slice(3)){
  const file=path.resolve(name),bytes=fs.readFileSync(file);let expected;
  try{const v=extractResourceArchive(bytes,DEFAULT_RESOURCE_PACK_LIMITS);expected={pack:v.pack,archiveFileCount:v.archiveFileCount,files:v.paths.map(p=>({path:p,size:v.files[p].length,sha256:sha(v.files[p])}))};}
  catch(error){assert.equal(error.name,'ResourcePackError',file);expected={error:error.code};}
  archives.push({path:file,sha256:sha(bytes),inputBytes:bytes.length,expected});
 }
 fs.writeFileSync(path.join(out,'native-resource-archive-files-oracle.json'),JSON.stringify({schema:1,sourceHashes,archives}));
 console.log(JSON.stringify({externalArchives:archives.map(a=>({name:path.basename(a.path),bytes:a.inputBytes,error:a.expected.error??null,files:a.expected.files?.length??0}))}));
}
