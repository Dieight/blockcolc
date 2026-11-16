import {readFileSync,readdirSync,statSync,writeFileSync,mkdirSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

// JVM org.json and Android's boot-class implementation are not the same API.
// Inspect actual bytecode descriptors, including method handles, rather than
// guessing overloads from source text or trusting a passing JVM unit test.
export function classApi(bytes){
 let at=0;const u1=()=>bytes.readUInt8(at++),u2=()=>{const n=bytes.readUInt16BE(at);at+=2;return n;},u4=()=>{const n=bytes.readUInt32BE(at);at+=4;return n;};
 assert.equal(u4(),0xcafebabe);u2();u2();const cp=Array(u2());
 for(let i=1;i<cp.length;i++){
  const tag=u1();if(tag===1){const n=u2();cp[i]={tag,value:bytes.toString('utf8',at,at+n)};at+=n;}
  else if([7,8,16,19,20].includes(tag))cp[i]={tag,index:u2()};
  else if([9,10,11,12,17,18].includes(tag))cp[i]={tag,a:u2(),b:u2()};
  else if(tag===15)cp[i]={tag,kind:u1(),index:u2()};
  else if(tag===3||tag===4){u4();cp[i]={tag};}
  else if(tag===5||tag===6){u4();u4();cp[i]={tag};i++;}
  else throw Error('Unknown class constant: '+tag);
 }
 const text=index=>{assert.equal(cp[index]?.tag,1);return cp[index].value;};
 const type=index=>index?text(cp[index].index):null;
 u2();const name=type(u2()),parent=type(u2()),interfaces=Array.from({length:u2()},()=>type(u2()));
 function attributes(){const n=u2();for(let i=0;i<n;i++){u2();const size=u4();at+=size;assert(at<=bytes.length);}}
 function members(){const result=[];const n=u2();for(let i=0;i<n;i++){const flags=u2(),name=text(u2()),descriptor=text(u2());attributes();if(flags&5)result.push(name+descriptor);}return result;}
 const fields=members(),methods=members();attributes();assert.equal(at,bytes.length);
 const references=cp.filter(c=>c&&[9,10,11].includes(c.tag)).map(c=>({kind:c.tag===9?'field':'method',owner:type(c.a),name:text(cp[c.b].a),descriptor:text(cp[c.b].b)}));
 return{name,parent,interfaces,fields,methods,references};
}

export function zipReader(bytes){
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 assert(end>=0,'SDK JAR central directory missing');const count=bytes.readUInt16LE(end+10),entries=new Map();let at=bytes.readUInt32LE(end+16);
 for(let i=0;i<count;i++){
  assert.equal(bytes.readUInt32LE(at),0x02014b50);const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),compressed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24);
  const nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42);
  const name=bytes.toString('utf8',at+46,at+46+nameLength);entries.set(name,{flags,method,compressed,size,offset});at+=46+nameLength+extra+comment;
 }
 return name=>{
  const e=entries.get(name);if(!e)return null;assert(!(e.flags&1)&&e.size<=8*1024*1024);assert.equal(bytes.readUInt32LE(e.offset),0x04034b50);
  const start=e.offset+30+bytes.readUInt16LE(e.offset+26)+bytes.readUInt16LE(e.offset+28),input=bytes.subarray(start,start+e.compressed);
  const result=e.method===0?input:e.method===8?inflateRawSync(input):null;assert(result&&result.length===e.size);return result;
 };
}

export function verifyReferences(classBytes,platform,cache=new Map()){
 const source=classApi(classBytes);
 function api(name){if(cache.has(name))return cache.get(name);const bytes=platform(name+'.class'),value=bytes?classApi(bytes):null;cache.set(name,value);return value;}
 function has(name,kind,member,seen=new Set()){
  if(!name||seen.has(name))return false;seen.add(name);const value=api(name);if(!value)return false;
  return value[kind==='field'?'fields':'methods'].includes(member)||has(value.parent,kind,member,seen)||value.interfaces.some(i=>has(i,kind,member,seen));
 }
 return source.references.filter(r=>r.owner.startsWith('org/json/')&&!has(r.owner,r.kind,r.name+r.descriptor)).map(r=>({class:source.name,...r}));
}

export function audit(sdkJar,directories){
 const sdk=readFileSync(sdkJar),platform=zipReader(sdk),missing=[],cache=new Map();let classes=0,references=0;
 assert(platform('org/json/JSONObject.class'),'SDK does not provide Android JSON');
 function visit(directory){for(const name of readdirSync(directory)){const file=path.join(directory,name);if(statSync(file).isDirectory())visit(file);else if(name.endsWith('.class')){
  const bytes=readFileSync(file),parsed=classApi(bytes);classes++;references+=parsed.references.filter(r=>r.owner.startsWith('org/json/')).length;missing.push(...verifyReferences(bytes,platform,cache));
 }}}
 for(const directory of directories){assert(statSync(directory).isDirectory());visit(directory);}
 return {schema:1,sdkSha256:createHash('sha256').update(sdk).digest('hex'),classes,jsonReferences:references,missing,passed:missing.length===0};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [sdk,output,...directories]=process.argv.slice(2);assert(sdk&&output&&directories.length,'SDK android.jar, report and compiled class directories required');
 const result=audit(sdk,directories);mkdirSync(path.dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2));
 console.log(JSON.stringify({classes:result.classes,jsonReferences:result.jsonReferences,missing:result.missing.length,passed:result.passed}));
 for(const r of result.missing.slice(0,30))console.error(`${r.class}: Android lacks ${r.kind} ${r.owner}.${r.name}${r.descriptor}`);
 if(!result.passed)process.exitCode=1;
}
