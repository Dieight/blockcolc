import {noise,smooth} from './landscape-fields';

type Material='grass'|'dirt'|'stone'|'water'|'sand'|'snow'|'ice'|'terracotta';
export interface Sample {height:number;material:Material;supportInfluence:number;moisture:number;waterKind:'none'|'river'|'lake';mountainSignal?:number;}
export interface SupportRect {minX:number;maxX:number;minZ:number;maxZ:number;height:number;}
export interface ValleyCascade {x:number;z:number;axis:'x'|'z';direction:1|-1;low:number}
export function createValleyCascades(radius:number,seed:number,heightAt:(x:number,z:number)=>number):ValleyCascade[]{
  const offset=(noise(seed^0x724a,radius,0,90)-.5)*24;
  return [{x:Math.round((radius+72)/4)*4,z:Math.round((-radius*.18+offset)/4)*4,axis:'x' as const,direction:-1 as const},
    {x:Math.round((-radius*.3-offset)/4)*4,z:Math.round((-radius-88)/4)*4,axis:'z' as const,direction:1 as const}]
    .map(site=>({...site,low:Math.max(2,Math.min(48,heightAt(site.x,site.z)))}));
}

/** Hanging pool, rock sill and plunge pool share one land field at every LOD.
 * The visible curtain later connects these exact surfaces. */
export function valleyCascade<T extends Sample>(sample:T,x:number,z:number,sites:readonly ValleyCascade[],includeWater=true):T{
  if(sample.supportInfluence>.02)return sample;
  for(const site of sites){
    const p=((site.axis==='x'?x:z)-(site.axis==='x'?site.x:site.z))*site.direction;
    const q=(site.axis==='x'?z:x)-(site.axis==='x'?site.z:site.x);
    const weight=(1-smooth(14,30,Math.abs(p)))*(1-smooth(9,22,Math.abs(q)));
    if(weight<=0)continue;
    const step=1-smooth(-2,2,p),land=site.low+2+step*14;
    const channel=includeWater&&p> -14&&p<15&&Math.abs(q)<2.8+smooth(0,9,p)*1.6;
    if(channel)return {...sample,height:Math.round(land-1),material:'water',waterKind:'river'};
    if(sample.waterKind!=='none')return sample;
    return {...sample,height:Math.round(sample.height+(land-sample.height)*weight),
      material:weight>.5&&Math.abs(p)<6?'stone':sample.material};
  }
  return sample;
}
export function createValleyBench(rects:readonly SupportRect[],roads:readonly {x:number;z:number}[],heightAt:(x:number,z:number)=>number){
  const bins=new Map<string,SupportRect[]>();
  const insert=(rect:SupportRect,radius:number)=>{for(let x=Math.floor((rect.minX-radius)/64);x<=Math.floor((rect.maxX+radius)/64);x++)for(let z=Math.floor((rect.minZ-radius)/64);z<=Math.floor((rect.maxZ+radius)/64);z++){
    const key=`${x}:${z}`,rows=bins.get(key)??[];rows.push(rect);bins.set(key,rows);
  }};
  for(const rect of rects)insert({...rect},128);
  // Road datums are fixed once, not repeatedly looked up for every terrain cell.
  for(const road of roads)insert({minX:road.x-1,maxX:road.x+1,minZ:road.z-1,maxZ:road.z+1,height:heightAt(road.x,road.z)},38);
  return {at(x:number,z:number,seed:number){
    let influence=0,height=0;
    for(const rect of bins.get(`${Math.floor(x/64)}:${Math.floor(z/64)}`)??[]){
      const distance=Math.hypot(Math.max(rect.minX-x,0,x-rect.maxX),Math.max(rect.minZ-z,0,z-rect.maxZ));
      const road=rect.maxX-rect.minX===2&&rect.maxZ-rect.minZ===2;
      const reach=road?34:108+(noise(seed^0x157b,x,z,53)-.5)*24;
      const weight=1-smooth(3,reach,distance);
      if(weight>=influence){influence=weight;height=rect.height;}
    }return{influence,height};
  }};
}

/** Lower a steep foundation apron into the existing hill field. Never create
 * new water, lift land, alter an actual foundation, or rewrite river/bank data. */
export function valleyBench<T extends Sample>(original:T,x:number,z:number,seed:number,bench:ReturnType<typeof createValleyBench>):T{
  if(original.supportInfluence>=.995||original.waterKind!=='none'||original.material==='dirt')return original;
  const support=bench.at(x,z,seed);if(support.influence<=.001||support.height>=original.height)return original;
  const weight=support.influence**1.25;
  const height=Math.max(support.height,Math.round(original.height+(support.height-original.height)*weight));
  return {...original,height};
}

/** A compact rounded shoulder, not a conical spike. The original wet mask and
 * shore width still decide whether this land exists. */
export function islandHill(distance:number,radius:number,height:number,variation:number,supportInfluence:number):number{
  const t=Math.max(0,distance)/(radius*1.7);if(t>=1)return 0;
  const fade=1-smooth(.04,.72,supportInfluence);
  return (1-t*t)**2*Math.max(0,height*.68+variation*2.5)*fade;
}
export function isletHeight(distance:number,shore:number,height:number,ridge:number):number{
  const t=Math.min(1,Math.max(0,distance/shore));
  return Math.max(1,Math.round((1-t*t)**2*height*(.65+ridge*.65)));
}

export function islandSurface(input:{height:number;distance:number;landRadius:number;coastWidth:number;shoreWarp:number;exposure:number;supportInfluence:number;x:number;z:number;seed:number;original:Material}):Material{
  const p=input;if(p.supportInfluence>=.08)return p.original;
  const detail=noise(p.seed^0x482a,p.x,p.z,17),broad=noise(p.seed^0x72ba,p.x,p.z,42);
  const edge=p.distance-p.landRadius;
  const sandReach=3+Math.max(0,1.08-p.shoreWarp)*p.coastWidth*3+(broad-.5)*4;
  if(p.height>=18&&detail>.3)return 'stone';
  if(p.exposure>.78&&edge> -1.5-p.exposure*2&&detail>.25)return 'stone';
  if(edge> -sandReach)return 'sand';
  return p.height>13&&broad>.72?'stone':'grass';
}
