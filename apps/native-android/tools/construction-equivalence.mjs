import assert from 'node:assert/strict';

/** Source and native both consume active tiles as a unique membership set.
 * Do not treat insertion order as geometry/material drift; still reject a
 * missing tile, duplicates, or any changed animation timing/image identity. */
export function canonicalAtlasActivity(animations){
  assert.ok(Array.isArray(animations));
  return animations.map(animation=>{
    const indices=animation.activeTextureIndices;
    assert.ok(Array.isArray(indices));
    assert.ok(indices.every(value=>Number.isInteger(value)&&value>=0&&value<animation.tileCount));
    assert.equal(new Set(indices).size,indices.length,'duplicate active tile');
    return {...animation,activeTextureIndices:[...indices].sort((a,b)=>a-b)};
  });
}
