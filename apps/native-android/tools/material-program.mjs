import * as THREE from 'three';

// This is an audit of the producer's program, not a GLSL-to-Filament translator.
// Keeping the actual patched source and live closure uniforms prevents two
// hooks with the same JS body from accidentally becoming one native material.
export function captureMaterialProgram(material, renderer) {
  const custom = material.isShaderMaterial || material.onBeforeCompile.toString() !== THREE.Material.prototype.onBeforeCompile.toString();
  if (!custom) return null;
  const library = material.isMeshBasicMaterial ? 'basic' : material.isMeshLambertMaterial ? 'lambert'
    : material.isMeshStandardMaterial ? 'standard' : material.isMeshDepthMaterial ? 'depth'
    : material.isSpriteMaterial?'sprite':material.isPointsMaterial?'points':null;
  if (!material.isShaderMaterial && !library) throw Error('No source shader library for '+material.type);
  const shader = {vertexShader:material.vertexShader ?? THREE.ShaderLib[library].vertexShader,
    fragmentShader:material.fragmentShader ?? THREE.ShaderLib[library].fragmentShader,
    uniforms:material.isShaderMaterial ? {...material.uniforms} : {}};
  material.onBeforeCompile(shader,renderer);
  return {type:material.type,cacheKey:material.customProgramCacheKey(),defines:{...material.defines},
    vertex:shader.vertexShader,fragment:shader.fragmentShader,uniforms:shader.uniforms};
}

export function describeProgram(program, textureIds) {
  if (!program) return null;
  const gaps=[];
  function value(input, name, depth=0) {
    if(depth>4)throw Error('Uniform nesting budget');
    if(typeof input==='number') {if(!Number.isFinite(input))throw Error('Non-finite uniform');return input;}
    if(typeof input==='boolean'||typeof input==='string'||input===null)return input;
    if(input?.isTexture) {
      const id=textureIds.get(input);
      if(id===undefined) {
        // The gap remains a refusal, never a white-texture fallback. Distinct
        // unencoded resources must not collapse to the same material either.
        gaps.push({kind:'unencoded-uniform-texture',name});
        return {unencodedTexture:input.uuid,type:input.type,format:input.format,width:input.image?.width,height:input.image?.height};
      }
      return {texture:id};
    }
    if(input?.isColor||input?.isVector2||input?.isVector3||input?.isVector4||input?.isMatrix3||input?.isMatrix4)
      return value(input.toArray(),name,depth+1);
    if(Array.isArray(input)||ArrayBuffer.isView(input)) {
      if(input.length>4096)throw Error('Uniform array budget');
      return Array.from(input,(item,i)=>value(item,name+'['+i+']',depth+1));
    }
    throw Error('Unencoded uniform type: '+name);
  }
  const uniforms=Object.fromEntries(Object.entries(program.uniforms).sort(([a],[b])=>a.localeCompare(b))
    .map(([name,uniform])=>[name,value(uniform.value,name)]));
  return {definition:{type:program.type,cacheKey:program.cacheKey,defines:program.defines,vertex:program.vertex,fragment:program.fragment},uniforms,gaps};
}
