import {describe,it,expect} from 'vitest';
import {blendNearTransition} from '../src/terrain-transition';
const dry=(height:number)=>({height,waterKind:'none',supportInfluence:0,material:'grass'});
describe('near-to-middle transition',()=>{
  it('does not move the inner terrain',()=>{const s=dry(4);expect(blendNearTransition(s,80,80,128,()=>dry(10))).toBe(s);});
  it('lands each straight edge on the actual next-ring lattice',()=>{
    const visited:number[][]=[];
    const s=blendNearTransition(dry(4),127,33,128,(x,z)=>{visited.push([x,z]);return dry(10);});
    expect(s.height).toBe(10);expect(visited).toEqual([[130,34]]);
  });
  it('protects water, foundations and protected neighbour data',()=>{
    for(const s of [{...dry(4),waterKind:'river'},{...dry(4),supportInfluence:.2}])expect(blendNearTransition(s,127,33,128,()=>dry(10))).toBe(s);
    const s=dry(4);expect(blendNearTransition(s,127,33,128,()=>({...dry(10),waterKind:'lake'}))).toBe(s);
    expect(blendNearTransition(s,127,33,128,()=>({...dry(10),supportInfluence:.5}))).toBe(s);
  });
  it('keeps the corner bridge bounded and symmetric without overriding the exact straight edge',()=>{
    const at=(x:number,z:number)=>dry(x>128?12:z>128?4:8);
    expect(blendNearTransition(dry(8),127,127,128,at).height).toBe(8);
    expect(blendNearTransition(dry(8),127,119,128,at).height).toBe(12);
  });
});
