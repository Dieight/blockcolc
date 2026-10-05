import type { BlueprintVoxel } from './blueprint';

const KINDS=['tube','brain','bubble','fire','horn'] as const;
function random(seed:number,x:number,z:number) {
  let n=Math.imul(x,374761393)^Math.imul(z,668265263)^seed;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}
function noise(seed:number,x:number,z:number) {
  const ix=Math.floor(x),iz=Math.floor(z),u=x-ix,v=z-iz;
  const a=u*u*(3-2*u),b=v*v*(3-2*v);
  return (random(seed,ix,iz)*(1-a)+random(seed,ix+1,iz)*a)*(1-b)
    +(random(seed,ix,iz+1)*(1-a)+random(seed,ix+1,iz+1)*a)*b;
}

/** A continuous, irregular reef bed with branching colonies and channels.
 * Coordinates, colour patches and heights belong to the bed, not a repeated
 * prefab. The caller clips it to actual warm water and protects other sites. */
export function createReefField(seed:number,halfX:number,halfZ:number,allowed:(x:number,z:number)=>boolean=()=>true) {
  const cells=new Map<string,{voxel:BlueprintVoxel;solid:boolean}>();
  const put=(x:number,y:number,z:number,block:string,solid=true,state?:Record<string,string>)=>{
    if(!allowed(x,z))return;
    cells.set(`${x}:${y}:${z}`,{voxel:{x,y,z,materialId:block==='sand'?'stone':'accent',buildOrder:0,
      sourceBlockId:`minecraft:${block}`,...(state?{sourceBlockState:state}:{})},solid});
  };
  const inside=(x:number,z:number)=>{
    const warpedX=x+(noise(seed+31,x/9,z/9)-.5)*7;
    const warpedZ=z+(noise(seed+77,x/11,z/11)-.5)*6;
    const edge=1-(warpedX/halfX)**2-(warpedZ/halfZ)**2;
    // A few winding sandy channels, not a regular grid between small islands.
    const channel=Math.abs(z-halfZ*.22*Math.sin(x/8+seed%13));
    return edge+(noise(seed,x/7,z/7)-.5)*.7>.05 && !(channel<1.3&&Math.abs(x)>halfX*.28);
  };
  for(let x=-halfX;x<=halfX;x++)for(let z=-halfZ;z<=halfZ;z++) {
    if(!inside(x,z)||!allowed(x,z))continue;
    put(x,0,z,'sand');
    const family=KINDS[Math.min(4,Math.floor(noise(seed+90,x/15,z/15)*5))]!;
    if(noise(seed+4,x/5,z/5)>.28)put(x,1,z,`${family}_coral_block`);
    if(random(seed+17,x,z)>.975)put(x,2,z,`${family}_coral_fan`,false,{waterlogged:'true'});
  }
  for(let x=-halfX+3;x<halfX;x+=5)for(let z=-halfZ+3;z<halfZ;z+=5) {
    const cx=x+Math.floor(random(seed+5,x,z)*3)-1,cz=z+Math.floor(random(seed+6,x,z)*3)-1;
    if(!inside(cx,cz)||!allowed(cx,cz)||random(seed+8,x,z)<.12)continue;
    const family=KINDS[Math.min(4,Math.floor(noise(seed+90,cx/15,cz/15)*5))]!;
    const form=Math.floor(random(seed+12,x,z)*3),height=1+Math.floor(random(seed+9,x,z)*2);
    for(let y=1;y<=height;y++)put(cx,y,cz,`${family}_coral_block`);
    for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++) {
      if(form===0?Math.abs(dx)+Math.abs(dz)>2:form===1?Math.abs(dx)>1||Math.abs(dz)>1:dz!==0&&Math.abs(dx)!==2)continue;
      if(random(seed+23,cx+dx,cz+dz)<.18)continue;
      put(cx+dx,height+1,cz+dz,`${family}_coral_block`);
      if(random(seed+24,cx+dx,cz+dz)>.76)put(cx+dx,height+2,cz+dz,`${family}_coral_fan`,false,{waterlogged:'true'});
    }
  }
  put(0,0,0,'sand');put(0,1,0,'sea_pickle',false,{pickles:String(1+seed%4),waterlogged:'true'});
  put(1,2,0,`${KINDS[seed%5]}_coral_fan`,false,{waterlogged:'true'});
  const sorted=[...cells.values()].sort((a,b)=>a.voxel.y-b.voxel.y||a.voxel.x-b.voxel.x||a.voxel.z-b.voxel.z);
  return {voxels:sorted.map(c=>c.voxel),distantVoxels:sorted.filter(c=>c.solid).map(c=>c.voxel)};
}
