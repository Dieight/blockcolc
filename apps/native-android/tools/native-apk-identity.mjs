import fs from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import assert from 'node:assert/strict';
/** Read bounded ZIP members without extracting paths or invoking platform tools. */
export function readApk(file){
 assert.ok(fs.statSync(file).size<=512*1024*1024,'APK exceeds inspection bound');const bytes=fs.readFileSync(file);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 assert.ok(end>=0,'APK central directory missing');const count=bytes.readUInt16LE(end+10);let cursor=bytes.readUInt32LE(end+16);const entries=new Map();
 for(let i=0;i<count;i++){
  assert.equal(bytes.readUInt32LE(cursor),0x02014b50);const method=bytes.readUInt16LE(cursor+10),size=bytes.readUInt32LE(cursor+24),packed=bytes.readUInt32LE(cursor+20),offset=bytes.readUInt32LE(cursor+42);
  const length=bytes.readUInt16LE(cursor+28),name=bytes.subarray(cursor+46,cursor+46+length).toString('utf8');assert.ok(!entries.has(name),'Duplicate APK member');
  entries.set(name,{method,size,packed,offset});cursor+=46+length+bytes.readUInt16LE(cursor+30)+bytes.readUInt16LE(cursor+32);
 }
 return {names:[...entries.keys()],read(name){
  const e=entries.get(name);assert.ok(e,'APK member missing: '+name);assert.ok(e.size<=64*1024*1024,'APK member exceeds inspection bound');assert.equal(bytes.readUInt32LE(e.offset),0x04034b50);
  const at=e.offset+30+bytes.readUInt16LE(e.offset+26)+bytes.readUInt16LE(e.offset+28),raw=bytes.subarray(at,at+e.packed);
  assert.ok(at+e.packed<=bytes.length,'Truncated APK member');const value=e.method===0?raw:e.method===8?inflateRawSync(raw,{maxOutputLength:64*1024*1024}):null;assert.ok(value,'Unsupported APK compression');assert.equal(value.length,e.size);return value;
 }};
}
export function apkIdentity(file){
 const apk=readApk(file),identity=JSON.parse(apk.read('assets/native-build.json'));
 assert.equal(identity.schema,1);
 assert.ok(['user-preview','diagnostic','upgrade-candidate'].includes(identity.mode));
 assert.equal(identity.applicationId,identity.mode==='upgrade-candidate'?'com.blockcolc.app':'com.blockcolc.preview');
 assert.equal(typeof identity.privateRelay,'boolean');
 return {apk,identity};
}
export function assertDiagnosticApk(file){
 const {apk,identity}=apkIdentity(file);assert.equal(identity.mode,'diagnostic','Diagnostic tool rejected user-preview APK before ADB; build explicitly with -PnativeDiagnostics=true');
 const dex=Buffer.concat(apk.names.filter(x=>/^classes[0-9]*\.dex$/.test(x)).map(x=>apk.read(x)));
 for(const marker of ['P2CostActivity','P3DerivedCacheCheckActivity','p2-startup-'])assert.ok(dex.includes(Buffer.from(marker)),'APK is missing explicit diagnostic implementation: '+marker);
 return identity;
}

/** Inspect class definitions, not Kotlin metadata references to removed types. */
export function dexClassNames(bytes){
 assert.ok(bytes.subarray(0,4).equals(Buffer.from('dex\n')),'Invalid DEX');
 const text=index=>{let at=bytes.readUInt32LE(bytes.readUInt32LE(60)+index*4);let prefix=0;while(bytes[at++]&128)assert.ok(++prefix<5,'Invalid DEX string length');let end=at;while(end<bytes.length&&bytes[end]!==0)end++;assert.ok(end<bytes.length,'Unterminated DEX string');return bytes.subarray(at,end).toString('utf8');};
 const types=bytes.readUInt32LE(68),count=bytes.readUInt32LE(96),base=bytes.readUInt32LE(100),result=[];
 for(let i=0;i<count;i++){const type=bytes.readUInt32LE(base+i*32);result.push(text(bytes.readUInt32LE(types+type*4)));}return result;
}
