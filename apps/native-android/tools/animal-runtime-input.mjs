const MAGIC=0x31414342;
const bounded=n=>Number.isFinite(n)&&Math.abs(n)<=1e6;
/** Engine-independent collision input. Terrain carries physical top y, not
 * placement supportY (+.5). Records keep source order and stable owners. */
export function encodeAnimalHabitat(surfaces,solids){
  if(surfaces.length>500000||solids.length>500000)throw Error('Animal collision count budget');
  const owners=[...new Set(solids.map(s=>s.owner))];
  if(owners.length>4096||owners.some(s=>typeof s!=='string'||!s.length||s.length>256))throw Error('Animal collision owner budget');
  const ids=new Map(owners.map((s,i)=>[s,i])),bytes=new Uint8Array(32+surfaces.length*24+solids.length*32),v=new DataView(bytes.buffer);
  for(const [i,n]of [MAGIC,1,bytes.length,surfaces.length,solids.length,owners.length,0,0].entries())v.setUint32(i*4,n,true);
  let at=32;
  for(const s of surfaces){
    const values=[s.minX,s.maxX,s.minZ,s.maxZ,s.top];
    if(!values.every(bounded)||s.minX>=s.maxX||s.minZ>=s.maxZ)throw Error('Invalid animal ground');
    values.forEach((n,i)=>v.setFloat32(at+i*4,n,true));v.setUint32(at+20,(s.water?1:0)|(s.grass?2:0),true);at+=24;
  }
  for(const s of solids){
    const values=[s.minX,s.maxX,s.minY,s.maxY,s.minZ,s.maxZ];
    if(!values.every(bounded)||s.minX>=s.maxX||s.minY>=s.maxY||s.minZ>=s.maxZ)throw Error('Invalid animal solid');
    values.forEach((n,i)=>v.setFloat32(at+i*4,n,true));v.setUint32(at+24,ids.get(s.owner),true);v.setUint32(at+28,(s.water?1:0)|(s.walkable!==false?2:0),true);at+=32;
  }
  return {bytes,owners,surfaceCount:surfaces.length,solidCount:solids.length};
}
