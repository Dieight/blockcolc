import type { ScenerySurface } from './scenery';

export interface PrecipitationGround {
  data:Float32Array; width:number; height:number; minX:number; minZ:number; spanX:number; spanZ:number; minY:number; maxY:number;
}

/** One terrain rebuild creates a bounded height texture, not a per-frame raycast. */
export function precipitationGroundForSurfaces(surfaces:readonly ScenerySurface[]):PrecipitationGround {
  const usable=surfaces.filter(s=>[s.minX,s.maxX,s.minZ,s.maxZ,s.supportY].every(Number.isFinite)&&s.maxX>s.minX&&s.maxZ>s.minZ);
  if(!usable.length)return {data:new Float32Array(1),width:1,height:1,minX:-1,minZ:-1,spanX:2,spanZ:2,minY:0,maxY:0};
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const s of usable){minX=Math.min(minX,s.minX);minZ=Math.min(minZ,s.minZ);maxX=Math.max(maxX,s.maxX);maxZ=Math.max(maxZ,s.maxZ);minY=Math.min(minY,s.supportY);maxY=Math.max(maxY,s.supportY);}
  const spanX=maxX-minX,spanZ=maxZ-minZ,width=Math.min(512,Math.max(1,Math.ceil(spanX/2))),height=Math.min(512,Math.max(1,Math.ceil(spanZ/2)));
  const data=new Float32Array(width*height).fill(minY);
  for(const s of usable){
    const x0=Math.max(0,Math.floor((s.minX-minX)/spanX*width)),x1=Math.min(width-1,Math.ceil((s.maxX-minX)/spanX*width)-1);
    const z0=Math.max(0,Math.floor((s.minZ-minZ)/spanZ*height)),z1=Math.min(height-1,Math.ceil((s.maxZ-minZ)/spanZ*height)-1);
    // A texel touching several steps uses the highest surface, never places
    // rain/snow inside a hillside. Water and dry ground share the same datum.
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)data[z*width+x]=Math.max(data[z*width+x]!,s.supportY);
  }
  return {data,width,height,minX,minZ,spanX,spanZ,minY,maxY};
}

export function precipitationGroundAt(ground:PrecipitationGround,x:number,z:number):number {
  const column=Math.min(ground.width-1,Math.max(0,Math.floor((x-ground.minX)/ground.spanX*ground.width)));
  const row=Math.min(ground.height-1,Math.max(0,Math.floor((z-ground.minZ)/ground.spanZ*ground.height)));
  return ground.data[row*ground.width+column]??0;
}
