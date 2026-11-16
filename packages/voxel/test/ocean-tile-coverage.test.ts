import {it,expect} from 'vitest';
import {createSteppedTerrainData} from '../src/terrain';

it.each([26,70,128])('partitions ocean rings and refined islets without overlapping water or holes at radius %s',radius=>{
  const data=createSteppedTerrainData([],[],[],{x:radius,z:radius},{environmentStyle:'ocean-island',worldSeed:'world-default'});
  const b=data.bounds,w=(b.maxX-b.minX)/2,h=(b.maxZ-b.minZ)/2,coverage=new Uint8Array(w*h),p=data.positions;
  let overlap=0;
  for(const indices of Object.values(data.indicesByMaterial))for(let i=0;i<indices.length;i+=6){
    let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
    for(let k=0;k<6;k++){const v=indices[i+k]!*3;x0=Math.min(x0,p[v]!);x1=Math.max(x1,p[v]!);z0=Math.min(z0,p[v+2]!);z1=Math.max(z1,p[v+2]!);}
    for(let z=(z0-b.minZ)/2;z<(z1-b.minZ)/2;z++)for(let x=(x0-b.minX)/2;x<(x1-b.minX)/2;x++){const index=z*w+x;if(coverage[index]!)overlap++;coverage[index]=coverage[index]!+1;}
  }
  expect(overlap).toBe(0);expect(coverage.filter(n=>n===0).length).toBe(0);
});
