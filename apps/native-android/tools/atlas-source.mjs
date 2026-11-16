// Evaluate only the static vertex part of the two production atlas families.
// One reusable geometry per appearance, never one expanded mesh per voxel.
const integer=(n,max)=>{if(!Number.isInteger(n)||n<0||n>max)throw Error('Invalid atlas packed input');return n;};
export const ATLAS_INSTANCE_NAMES=['instanceFaceTilesA','instanceFaceTilesB','instanceFaceUvWordA0','instanceFaceUvWordA1',
  'instanceFaceUvWordB0','instanceFaceUvWordB1','instanceFaceTintKinds'];
export const ATLAS_VERTEX_NAMES=['faceSlot','faceOcclusionSlot','faceShadeFactor'];
const tintNames=['','blockcolcFoliageTint','blockcolcGrassTint','blockcolcWaterTint','blockcolcDryFoliageTint',
  'blockcolcSpruceLeavesTint','blockcolcBirchLeavesTint','blockcolcLilyPadTint','blockcolcStateTint','blockcolcStateTint','blockcolcStateTint'];
export function atlasDefinition(material,program){
  if(!program||!/^blockcolc-atlas-(?:v6-fluid|geometry-v3)-(?:opaque|cutout|translucent)-(?:static|animated)(?:\||$)/.test(program.cacheKey))return null;
  const shape=program.cacheKey.startsWith('blockcolc-atlas-geometry-'),u=program.uniforms;
  const get=name=>{if(!u[name])throw Error('Atlas uniform missing: '+name);return u[name].value;};
  const size=get('blockcolcAtlasSize').toArray(),columns=get('blockcolcAtlasColumns'),cell=get('blockcolcAtlasCellSize'),padding=get('blockcolcAtlasPadding');
  if(size.length!==2||size.some(x=>!Number.isInteger(x)||x<1||x>8192)||!Number.isInteger(columns)||columns<1||columns>8192
    ||!Number.isInteger(cell)||cell<1||cell>1024||!Number.isFinite(padding)||padding<0||padding*2>=cell)throw Error('Invalid atlas dimensions');
  const tints=tintNames.map(name=>name?get(name).toArray():[1,1,1]);
  if(tints.some(v=>v.length!==3||v.some(x=>!Number.isFinite(x)||x<0||x>1)))throw Error('Invalid source tint');
  if(material.map?.matrixAutoUpdate)material.map.updateMatrix();
  const result={shape,size,columns,cell,padding,tints,matrix:Array.from(material.map?.matrix.elements??[1,0,0,0,1,0,0,0,1]),vertexColors:!!material.vertexColors};
  return {...result,key:JSON.stringify(result)};
}
export function atlasAppearance(geometry,index,definition){
  const vector=name=>{const a=geometry.getAttribute(name);if(!a||!a.isInstancedBufferAttribute||a.itemSize!==3||a.normalized||a.meshPerAttribute!==1||index>=a.count)throw Error('Atlas instance layout changed: '+name);
    return [a.getX(index),a.getY(index),a.getZ(index)].map(n=>integer(n,16777215));};
  const a=geometry.getAttribute('instanceFaceTintKinds');if(!a||!a.isInstancedBufferAttribute||a.itemSize!==1||a.normalized||a.meshPerAttribute!==1||index>=a.count)throw Error('Atlas tint layout changed');
  const tiles=[...vector('instanceFaceTilesA'),...vector('instanceFaceTilesB')];if(tiles.some(n=>n>=65536))throw Error('Atlas tile budget');
  const uvA=definition.shape?[]:[...vector('instanceFaceUvWordA0'),...vector('instanceFaceUvWordA1')];
  const uvB=definition.shape?[]:[...vector('instanceFaceUvWordB0'),...vector('instanceFaceUvWordB1')];
  const tint=integer(a.getX(index),16777215),occlusion=geometry.getAttribute('instanceFaceOcclusion')?.getX(index)??0;
  integer(occlusion,16777215);
  // A fluid's direction changes its UVs, but ordinary local occlusion remains
  // in the existing per-instance channel and does not duplicate geometry.
  const flow=!definition.shape&&occlusion>1000000?occlusion:0;
  return {tiles,uvA,uvB,tint,flow,key:JSON.stringify([tiles,uvA,uvB,tint,flow])+'|'+definition.key};
}
export function bakeAtlasVertex({uv,position,normal,slot,occlusionSlot,shade,color=[1,1,1,1]},appearance,d){
  if(!d.shape){slot=Math.abs(normal[0])>.5?(normal[0]<0?4:5):Math.abs(normal[1])>.5?(normal[1]<0?0:1):(normal[2]<0?2:3);
    occlusionSlot=slot;shade=slot===0?.5:slot===1?1:slot<4?.8:.6;}
  integer(slot,5);integer(occlusionSlot,5);if(!Number.isFinite(shade)||shade<0||shade>1)throw Error('Invalid source face shade');
  let [u,v]=uv;const m=d.matrix;[u,v]=[m[0]*u+m[3]*v+m[6],m[1]*u+m[4]*v+m[7]];
  const sourceUv=[u,v];
  let x=u*(d.cell-2*d.padding),y=v*(d.cell-2*d.padding);
  if(!d.shape){
    const meta=appearance.flow-1000000;
    if(meta>.5&&((Math.floor(meta/32768)%2)>0)&&slot===1){
      const angle=(meta%32768)*Math.PI*2/4096,s=.25*Math.sin(angle),c=.25*Math.cos(angle);
      [u,v]=position[2]<0?(position[0]<0?[.5-c-s,.5-c+s]:[.5+c-s,.5-c-s]):position[0]<0?[.5-c+s,.5+c+s]:[.5+c+s,.5+c-s];
    }
    const a=appearance.uvA[slot],b=appearance.uvB[slot],rotation=Math.floor(a/4194304)%4;
    // The source rotation patch refers to vMapUv, not the intermediate flow
    // UV. A nonzero face rotation therefore overrides the flow-top mapping.
    if(rotation===3)[u,v]=[1-sourceUv[1],sourceUv[0]];else if(rotation===2)[u,v]=[1-sourceUv[0],1-sourceUv[1]];else if(rotation===1)[u,v]=[sourceUv[1],1-sourceUv[0]];
    const extent=d.cell-2*d.padding,start=[a%2048/2047,Math.floor(a/2048)%2048/2047],end=[b%2048/2047,Math.floor(b/2048)%2048/2047];
    [x,y]=[u,v].map((q,k)=>{const delta=(end[k]-start[k])*extent,abs=Math.abs(delta);return start[k]*extent+(delta>=0?1:-1)*(Math.min(.5,abs*.5)+q*Math.max(abs-1,0));});
  }
  const tile=appearance.tiles[slot],kind=Math.floor(appearance.tint/16**slot)%16;
  const tint=d.tints[kind]??[1,1,1];
  if(d.vertexColors&&color[3]!==1)throw Error('Unreviewed atlas vertex alpha');
  return {uv:[((tile%d.columns)*d.cell+d.padding+x)/d.size[0],(Math.floor(tile/d.columns)*d.cell+d.padding+y)/d.size[1]],
    // Alpha is an explicit source face slot in this prepared layout, not alpha.
    color:[...tint.map((t,k)=>t*shade*(d.vertexColors?color[k]:1)),occlusionSlot]};
}
