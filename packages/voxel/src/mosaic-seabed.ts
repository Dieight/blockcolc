import { mosaicSeabedHeight } from './mosaic-terrain';
import type { ScenerySurface } from './scenery';

/** Matches real water quads and shared shelf heights; no flat plane under the whole world. */
export function createMosaicSeabed(surfaces: readonly ScenerySurface[], seed: number, coreRadius: number) {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const cache = new Map<string, {y:number;normal:readonly number[]}>();
  const vertex=(x:number,z:number)=>{
    const key=`${x}:${z}`;
    let sample=cache.get(key);
    if(!sample){
      const y=mosaicSeabedHeight(x,z,seed,coreRadius);
      const nx=(mosaicSeabedHeight(x-1,z,seed,coreRadius)-mosaicSeabedHeight(x+1,z,seed,coreRadius))/2;
      const nz=(mosaicSeabedHeight(x,z-1,seed,coreRadius)-mosaicSeabedHeight(x,z+1,seed,coreRadius))/2;
      const length=Math.hypot(nx,1,nz);sample={y,normal:[nx/length,1/length,nz/length]};cache.set(key,sample);
    }
    positions.push(x,sample.y,z);normals.push(...sample.normal);uvs.push(x/6,z/6);
  };
  for(const s of surfaces){
    if(!s.water||s.minX>=s.maxX||s.minZ>=s.maxZ)continue;
    const nx=Math.max(1,Math.ceil((s.maxX-s.minX)/8)),nz=Math.max(1,Math.ceil((s.maxZ-s.minZ)/8));
    for(let ix=0;ix<nx;ix++)for(let iz=0;iz<nz;iz++){
      const x0=s.minX+(s.maxX-s.minX)*ix/nx,x1=s.minX+(s.maxX-s.minX)*(ix+1)/nx;
      const z0=s.minZ+(s.maxZ-s.minZ)*iz/nz,z1=s.minZ+(s.maxZ-s.minZ)*(iz+1)/nz,i=positions.length/3;
      vertex(x0,z0);vertex(x0,z1);vertex(x1,z1);vertex(x1,z0);indices.push(i,i+1,i+2,i,i+2,i+3);
    }
  }
  return {positions,normals,uvs,indices};
}
