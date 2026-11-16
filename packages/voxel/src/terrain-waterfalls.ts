import * as THREE from 'three';
import type {SurfaceSource,ScenerySurface} from './terrain-surface-table';

export interface WaterfallFace {axis:'x'|'z';line:number;start:number;end:number;top:number;bottom:number;direction:1|-1}
type Edge={line:number;start:number;end:number;surface:ScenerySurface};

/** Join actual neighbouring river surfaces. Never invent water above dry land,
 * bridge a gap, or include these vertical curtains in the ground-height table. */
export function valleyWaterfallFaces(surfaces:SurfaceSource):WaterfallFace[]{
  const edges:{low:Map<string,Edge[]>;high:Map<string,Edge[]>}={low:new Map(),high:new Map()};
  const insert=(map:Map<string,Edge[]>,axis:'x'|'z',line:number,start:number,end:number,surface:ScenerySurface)=>{
    const key=axis+':'+line,rows=map.get(key)??[];rows.push({line,start,end,surface});map.set(key,rows);
  };
  for(const s of surfaces){
    if(!s.water||s.maxX-s.minX>4||s.maxZ-s.minZ>4)continue;
    insert(edges.low,'x',s.minX,s.minZ,s.maxZ,s);insert(edges.high,'x',s.maxX,s.minZ,s.maxZ,s);
    insert(edges.low,'z',s.minZ,s.minX,s.maxX,s);insert(edges.high,'z',s.maxZ,s.minX,s.maxX,s);
  }
  const result:WaterfallFace[]=[];
  for(const [key,high]of edges.high){
    for(const a of high)for(const b of edges.low.get(key)??[]){
      const start=Math.max(a.start,b.start),end=Math.min(a.end,b.end),delta=a.surface.supportY-b.surface.supportY;
      if(end-start<.1||Math.abs(delta)<2)continue;
      result.push({axis:key[0] as 'x'|'z',line:a.line,start,end,top:Math.max(a.surface.supportY,b.surface.supportY)-.5,
        bottom:Math.min(a.surface.supportY,b.surface.supportY)-.5,direction:delta>0?1:-1});
    }
  }
  return result.sort((a,b)=>(b.top-b.bottom)-(a.top-a.bottom)||a.line-b.line||a.start-b.start).slice(0,128);
}

/** One lit draw call. Vertical pixel streaks advect downwards; no per-drop
 * meshes, new lights, particle timers, reflection plane or second terrain. */
export function createValleyWaterfallMesh(faces:readonly WaterfallFace[],clock:{value:number}):THREE.Mesh|null{
  if(!faces.length)return null;
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
  for(const face of faces){
    const {axis,start,end,top,bottom}=face,line=face.line+face.direction*.018,offset=positions.length/3;
    for(const [across,y] of [[start,bottom],[start,top],[end,top],[end,bottom]]){
      positions.push(axis==='x'?line:across!,y!,axis==='z'?line:across!);uvs.push(across!,y!);
    }
    indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial({color:0x83cedf,roughness:.62,side:THREE.DoubleSide,transparent:true,opacity:.87,depthWrite:false});
  material.onBeforeCompile=shader=>{
    shader.uniforms.uCascadeClock=clock;
    shader.vertexShader='varying vec2 vCascadeUv;\n'+shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvCascadeUv=uv;');
    shader.fragmentShader='uniform float uCascadeClock;varying vec2 vCascadeUv;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 cell=floor(vec2(vCascadeUv.x*5.0,(vCascadeUv.y+uCascadeClock*3.8)*3.0));
      float streak=fract(sin(dot(cell,vec2(12.9898,78.233)))*43758.5453);
      diffuseColor.rgb*=mix(.72,1.42,step(.68,streak));`);
  };
  material.customProgramCacheKey=()=> 'blockcolc-valley-cascade-1';
  const mesh=new THREE.Mesh(geometry,material);mesh.name='valley-waterfalls';mesh.receiveShadow=true;mesh.renderOrder=11;
  mesh.userData.ownedMaterial=material;mesh.userData.faces=faces;return mesh;
}
