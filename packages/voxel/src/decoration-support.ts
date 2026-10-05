import {surfaceSampler,type ScenerySurface} from './scenery';
import type {ImportedDecorationPlacement} from './village';
import type {BlueprintVoxel} from './blueprint';

/** Read existing ground; a reward is not a terrain-flattening constraint. */
type SurfaceSource=readonly ScenerySurface[]|((x:number,z:number)=>ScenerySurface|undefined);
export function supportImportedDecorations(decorations:readonly ImportedDecorationPlacement[],surfaces:SurfaceSource):ImportedDecorationPlacement[]{
  const at=typeof surfaces==='function'?surfaces:surfaceSampler(surfaces);
  return decorations.map(decoration=>{
    let ground=-Infinity;
    const {width,depth}=decoration.footprint;
    for(let dx=-width/2;dx<=width/2;dx+=2)for(let dz=-depth/2;dz<=depth/2;dz+=2){
      const surface=at(decoration.worldPosition.x+dx,decoration.worldPosition.z+dz);
      if(surface)ground=Math.max(ground,surface.supportY);
    }
    return {...decoration,worldPosition:{...decoration.worldPosition,y:(Number.isFinite(ground)?ground:decoration.worldPosition.y)-decoration.blueprint.bounds.minY}};
  });
}
/** Small block footings bridge uneven ground without replacing any terrain. */
export function decorationFoundationVoxels(decoration:ImportedDecorationPlacement,surfaces:SurfaceSource):BlueprintVoxel[]{
  const at=typeof surfaces==='function'?surfaces:surfaceSampler(surfaces),result:BlueprintVoxel[]=[],cos=Math.cos(decoration.rotationY),sin=Math.sin(decoration.rotationY);
  for(const voxel of decoration.blueprint.voxels.filter(v=>v.y===decoration.blueprint.bounds.minY)){
    const x=voxel.x+decoration.blueprintOffset.x,z=voxel.z+decoration.blueprintOffset.z;
    const ground=at(decoration.worldPosition.x+x*cos+z*sin,decoration.worldPosition.z-x*sin+z*cos);
    if(!ground)continue;
    const bottom=Math.ceil(ground.supportY-decoration.worldPosition.y);
    for(let y=voxel.y-1;y>=bottom;y--)result.push({x:voxel.x,y,z:voxel.z,materialId:'stone',sourceBlockId:'minecraft:stone_bricks',buildOrder:0});
  }
  return result;
}
