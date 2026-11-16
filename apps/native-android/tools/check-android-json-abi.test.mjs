import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classApi,verifyReferences} from './check-android-json-abi.mjs';

function fixture({floatOverload=false,referenceFloat=false,name='org/json/JSONObject'}={}){
 const pool=[],parts=[];const u1=n=>Buffer.from([n]),u2=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;},u4=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
 const text=s=>{pool.push(Buffer.concat([u1(1),u2(Buffer.byteLength(s)),Buffer.from(s)]));return pool.length;};
 const type=n=>{const key=text(n);pool.push(Buffer.concat([u1(7),u2(key)]));return pool.length;};
 const own=type(name),parent=type('java/lang/Object'),method=text('put'),double=text('(Ljava/lang/String;D)Lorg/json/JSONObject;'),float=text('(Ljava/lang/String;F)Lorg/json/JSONObject;');
 pool.push(Buffer.concat([u1(12),u2(method),u2(referenceFloat?float:double)]));const pair=pool.length;
 pool.push(Buffer.concat([u1(10),u2(own),u2(pair)]));
 parts.push(u4(0xcafebabe),u2(0),u2(61),u2(pool.length+1),...pool,u2(1),u2(own),u2(parent),u2(0),u2(0),u2(floatOverload?2:1));
 for(const descriptor of floatOverload?[double,float]:[double])parts.push(u2(1),u2(method),u2(descriptor),u2(0));parts.push(u2(0));return Buffer.concat(parts);
}
test('class parser preserves overload descriptors rather than just method names',()=>{
 const parsed=classApi(fixture({floatOverload:true}));assert.equal(parsed.name,'org/json/JSONObject');assert.equal(parsed.methods.length,2);assert.equal(parsed.references.length,1);
 assert(parsed.methods.some(m=>m.includes(';F)')));assert(parsed.methods.some(m=>m.includes(';D)')));
});
test('Android JSON accepts double overload but rejects JVM-only float overload',()=>{
 const platform=name=>name==='org/json/JSONObject.class'?fixture():null;
 assert.deepEqual(verifyReferences(fixture(),platform),[]);
 const missing=verifyReferences(fixture({referenceFloat:true}),platform);assert.equal(missing.length,1);assert.equal(missing[0].descriptor,'(Ljava/lang/String;F)Lorg/json/JSONObject;');
});
test('truncated class inputs are not counted as compatible',()=>{
 assert.throws(()=>classApi(fixture().subarray(0,23)));
});
