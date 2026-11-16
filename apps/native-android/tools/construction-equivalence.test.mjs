import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalAtlasActivity} from './construction-equivalence.mjs';
const frame=indices=>[{tileCount:10,activeTextureIndices:indices,sequences:[{time:3}],lookupPixelsSha256:'abc'}];
test('active tile order is immaterial but no membership is dropped',()=>{
  const a=frame([3,1]);assert.deepEqual(canonicalAtlasActivity(a),canonicalAtlasActivity(frame([1,3])));
  assert.deepEqual(a,frame([3,1]));
  assert.notDeepEqual(canonicalAtlasActivity(a),canonicalAtlasActivity(frame([1])));
  assert.notDeepEqual(canonicalAtlasActivity(a),canonicalAtlasActivity([{...a[0],sequences:[{time:4}]}]));
});
test('duplicate, out-of-range or non-integer tiles remain invalid',()=>{
  for(const indices of [[1,1],[-1],[10],[.5],['1']])assert.throws(()=>canonicalAtlasActivity(frame(indices)));
});
