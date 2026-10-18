import type { BlueprintVoxel } from './blueprint-model';

export interface RenderTextureReferences {
  animated: Map<number,Set<number>>;
  fluids: Map<number,Set<number>>;
}

const remember=(map:Map<number,Set<number>>,page:number,index:number)=>{
  const indices=map.get(page)??new Set<number>();indices.add(index);map.set(page,indices);
};

/** Record uses, not differences from a shared set: another root may already
 * reference the same tile and disappear on the next update. */
export function createRenderReferenceCollector(){
  const owners:RenderTextureReferences[]=[];
  return {
    animated(page:number,index:number){for(const owner of owners)remember(owner.animated,page,index);},
    fluid(page:number,index:number){for(const owner of owners)remember(owner.fluids,page,index);},
    capture<T>(build:()=>T):{value:T;references:RenderTextureReferences}{
      const references:RenderTextureReferences={animated:new Map(),fluids:new Map()};owners.push(references);
      try{return {value:build(),references};}finally{owners.pop();}
    },
  };
}

/** These displays share a per-rebuild atlas/template owner. Keep their normal
 * disposal path until that owner also supports independent retained roots. */
export function hasRebuildOwnedDisplay(voxels:readonly BlueprintVoxel[]):boolean{
  return voxels.some(voxel=>voxel.sign!==undefined||voxel.campfire!==undefined
    ||voxel.sourceBlockId?.endsWith('_sign')===true);
}
