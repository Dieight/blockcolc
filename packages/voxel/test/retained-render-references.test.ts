import {describe,it,expect} from 'vitest';
import {createRenderReferenceCollector,hasRebuildOwnedDisplay} from '../src/retained-render-references';
import {createLocalOcclusionField,lazyLocalOcclusionField} from '../src/local-occlusion';

describe('retained render roots',()=>{
  it('records shared uses independently and preserves all nested owners',()=>{
    const collector=createRenderReferenceCollector();
    const first=collector.capture(()=>{collector.animated(0,4);return 1;});
    const second=collector.capture(()=>{collector.animated(0,4);collector.fluid(1,2);return collector.capture(()=>collector.animated(2,8));});
    expect(first.value).toBe(1);expect([...first.references.animated.get(0)!]).toEqual([4]);
    expect([...second.references.animated.get(0)!]).toEqual([4]);expect([...second.references.animated.get(2)!]).toEqual([8]);
    expect([...second.value.references.animated.get(2)!]).toEqual([8]);expect([...second.references.fluids.get(1)!]).toEqual([2]);
    collector.animated(0,9);expect([...first.references.animated.get(0)!]).toEqual([4]);
  });
  it('releases the collector after a failed build',()=>{
    const collector=createRenderReferenceCollector();
    expect(()=>collector.capture(()=>{collector.animated(0,1);throw new Error('aborted');})).toThrow('aborted');
    const clean=collector.capture(()=>collector.animated(0,2));expect([...clean.references.animated.get(0)!]).toEqual([2]);
  });
  it('keeps deferred neighbour fields equivalent and only builds once when sampled',()=>{
    const voxels=[{x:0,y:0,z:0,buildOrder:10000,materialId:'stone' as const}];let builds=0;
    const field=lazyLocalOcclusionField(()=>{builds++;return createLocalOcclusionField(voxels);});
    expect(builds).toBe(0);expect(field.has!(0,0,0)).toBe(true);expect(field.has!(1,0,0)).toBe(false);
    expect(field.occupied).toEqual(new Set(['0:0:0']));expect(field.minimumY).toBe(0);expect(builds).toBe(1);
  });
  it('excludes shared block entity displays without excluding ordinary animated textures',()=>{
    const voxel={x:0,y:0,z:0,buildOrder:10000,materialId:'stone' as const};
    for(const sourceBlockId of ['minecraft:oak_sign','minecraft:oak_wall_hanging_sign'])
      expect(hasRebuildOwnedDisplay([{...voxel,sourceBlockId}])).toBe(true);
    expect(hasRebuildOwnedDisplay([{...voxel,sourceBlockId:'minecraft:campfire',campfire:{slots:[]}}])).toBe(true);
    expect(hasRebuildOwnedDisplay([{...voxel,sourceBlockId:'minecraft:campfire'}])).toBe(false);
    expect(hasRebuildOwnedDisplay([{...voxel,sourceBlockId:'minecraft:water'}])).toBe(false);
    expect(hasRebuildOwnedDisplay([{...voxel,sourceBlockId:'minecraft:oak_leaves'}])).toBe(false);
  });
});
