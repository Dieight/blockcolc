import type { CloudKind } from './cloud-layout';

export interface CloudVoxel { x:number; y:number; z:number }
type Lobe = readonly [number,number,number,number,number,number];

/** Sample volumes on a cubic lattice, then discard enclosed voxels. The sides
 * and underside have the same steps as the crown: no stretched white slabs.
 * WMO genera guide the silhouettes, not a claim of meteorological simulation. */
export function cloudVoxels(kind:CloudKind,variant:number):CloudVoxel[]{
  let seed=variant|0;const random=()=>{seed=Math.imul(seed,1664525)+1013904223|0;return(seed>>>0)/4294967296;};
  const lobes:Lobe[]=[];
  const lobe=(x:number,y:number,z:number,rx:number,ry:number,rz:number)=>lobes.push([x,y,z,rx,ry,rz]);
  if(kind==='cirrus'){
    for(let i=0;i<5;i++)lobe(-5+i*2.5,1+i*.2,Math.sin(i*.9)*.8,2.5,1.05,1.25);
  }else if(kind==='stratus'||kind==='bank'){
    const columns=kind==='bank'?5:3;
    for(let x=0;x<columns;x++)for(let z=0;z<3;z++)lobe((x-(columns-1)/2)*3,1+random()*.4,(z-1)*2.2,3.2,1.2+random()*.6,2.7);
  }else if(kind==='altocumulus'){
    for(let x=0;x<4;x++)for(let z=0;z<2;z++)lobe((x-1.5)*3.1,1+random(),(z-.5)*3,2.4,1.7+random(),2.1);
  }else{
    lobe(0,1.2,0,5.1,1.8,3.6);
    for(let i=0;i<5;i++)lobe((i-2)*1.8,2+random()*1.3,(random()-.5)*3,2.6+random(),2.3+random()*1.4,2.5);
    if(kind==='storm'){
      lobe(.5,4,0,3.4,4.1,3.1);
      lobe(1.5,7.2,.4,5.6,1.4,3.8); // tower and anvil
    }
  }
  const occupied=new Set<string>(),cells:CloudVoxel[]=[];
  const key=(x:number,y:number,z:number)=>`${x},${y},${z}`;
  for(let y=-1;y<=10;y++)for(let z=-6;z<=6;z++)for(let x=-11;x<=11;x++){
    if(lobes.some(([cx,cy,cz,rx,ry,rz])=>((x-cx)/rx)**2+((y-cy)/ry)**2+((z-cz)/rz)**2<=1)){
      occupied.add(key(x,y,z));cells.push({x,y,z});
    }
  }
  const neighbors=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const;
  return cells.filter(({x,y,z})=>neighbors.some(([dx,dy,dz])=>!occupied.has(key(x+dx,y+dy,z+dz))));
}
