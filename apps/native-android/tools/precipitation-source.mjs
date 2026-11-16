import * as THREE from 'three';
import {captureMaterialProgram} from './material-program.mjs';

/** Preserve the allocated seed population, not only the current camera's
 * active prefix. A proxy changes no source mesh, seed, visibility or buffer. */
export function precipitationSource(policy) {
  const proxies=new WeakMap();
  return {...policy,resolveMesh(object){
    const original=policy.resolveMesh(object);
    if(!['world-rain','world-snow'].includes(original.name))return original;
    if(!proxies.has(original)){
      if(!original.isInstancedMesh||!original.geometry.getAttribute('weatherPhase')||!original.geometry.getAttribute('weatherOffset'))
        throw Error('Missing source precipitation seeds');
      const proxy=Object.create(original);proxy.count=original.instanceMatrix.count;
      if(proxy.count<original.count||proxy.count>49152)throw Error('Precipitation capacity budget');
      proxies.set(original,proxy);
    }
    return proxies.get(original);
  }};
}

/** Include sampler closures as resources. A material map inventory alone
 * misses the floating-point ground sampler used by precipitation vertices. */
export function materialTextures(material,renderer) {
  const found=new Set(material.map?[material.map]:[]);
  const program=captureMaterialProgram(material,renderer);
  for(const uniform of Object.values(program?.uniforms??{}))if(uniform.value?.isTexture)found.add(uniform.value);
  return found;
}

export async function encodeTexture(texture,hash) {
  const image=texture.image,width=image?.width,height=image?.height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192||width*height>32*1024*1024)
    throw Error('Texture image budget');
  let bytes,encoding,extension;
  if(texture.type===THREE.FloatType){
    if(texture.format!==THREE.RedFormat||!(image.data instanceof Float32Array)||image.data.length!==width*height
      ||width>512||height>512||texture.colorSpace!==THREE.NoColorSpace||texture.flipY||texture.generateMipmaps
      ||texture.minFilter!==THREE.NearestFilter||texture.magFilter!==THREE.NearestFilter
      ||texture.wrapS!==THREE.ClampToEdgeWrapping||texture.wrapT!==THREE.ClampToEdgeWrapping)
      throw Error('Unreviewed floating-point texture layout');
    const data=new ArrayBuffer(width*height*4),view=new DataView(data);
    for(let i=0;i<image.data.length;i++){
      if(!Number.isFinite(image.data[i])||Math.abs(image.data[i])>1e6)throw Error('Invalid ground height');
      view.setFloat32(i*4,image.data[i],true);
    }
    bytes=new Uint8Array(data);encoding='r32f-le';extension='f32';
  }else{
    if(texture.type!==THREE.UnsignedByteType)throw Error('Unreviewed image channel type');
    const target=document.createElement('canvas');target.width=width;target.height=height;
    const context=target.getContext('2d');
    if(image.data)context.putImageData(new ImageData(new Uint8ClampedArray(image.data),width,height),0,0);
    else context.drawImage(image,0,0);
    bytes=Uint8Array.from(atob(target.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));encoding='png';extension='png';
  }
  const id=await hash(bytes);
  return {filename:'images/'+id+'.'+extension,bytes,descriptor:{image:id,width,height,encoding,
    colorSpace:texture.colorSpace,wrapS:texture.wrapS,wrapT:texture.wrapT,minFilter:texture.minFilter,
    magFilter:texture.magFilter,anisotropy:texture.anisotropy}};
}
