import {describe,it,expect} from 'vitest';
import {createValleyBench,valleyBench,createValleyCascades,valleyCascade,islandHill,isletHeight,islandSurface,type Sample} from '../src/terrain-landforms';
describe('valley and island landforms',()=>{
  const base:Sample={height:40,material:'grass',supportInfluence:0,moisture:.5,waterKind:'none'};
  it('plants cascades outside the core, grades their banks and keeps foundations dry',()=>{
    const sites=createValleyCascades(100,1234,()=>7);
    expect(sites).toEqual(createValleyCascades(100,1234,()=>7));
    for(const site of sites){
      expect(Math.max(Math.abs(site.x),Math.abs(site.z))).toBeGreaterThan(140);
      const at=(p:number,q=0,water=true)=>valleyCascade(base,
        site.x+(site.axis==='x'?p*site.direction:q),site.z+(site.axis==='z'?p*site.direction:q),sites,water);
      const high=at(-4),low=at(4);expect(high.material).toBe('water');expect(low.material).toBe('water');
      expect(high.height-low.height).toBe(14);expect(at(-4,7).height).toBeGreaterThan(high.height);
      expect(at(4,7).height).toBeGreaterThan(low.height);expect(at(4,0,false).waterKind).toBe('none');
      const protectedLand={...base,supportInfluence:1};expect(valleyCascade(protectedLand,site.x,site.z,sites)).toBe(protectedLand);
    }
  });
  it('makes a wider, graded valley apron without lifting land or moving actual foundations',()=>{
    const bench=createValleyBench([{minX:-10,maxX:10,minZ:-10,maxZ:10,height:3}],[],()=>3),heights:number[]=[];
    for(let x=10;x<=150;x+=2){const s=valleyBench(base,x,0,1234,bench);heights.push(s.height);expect(s.height).toBeLessThanOrEqual(40);expect(s.height).toBeGreaterThanOrEqual(3);}
    expect(heights[0]).toBe(3);expect(heights.at(-1)).toBe(40);expect(Math.max(...heights.slice(1).map((h,i)=>Math.abs(h-heights[i]!)))).toBeLessThanOrEqual(3);
    const foundation={...base,height:3,supportInfluence:1};expect(valleyBench(foundation,0,0,1234,bench)).toBe(foundation);
    expect(valleyBench(base,60,0,1234,bench).height).toBeLessThan(30);
  });
  it('preserves rivers, lakes, banks and out-of-range samples exactly',()=>{
    const bench=createValleyBench([{minX:-10,maxX:10,minZ:-10,maxZ:10,height:3}],[],()=>3);
    for(const waterKind of ['river','lake'] as const){const water={...base,material:'water' as const,waterKind};expect(valleyBench(water,25,0,1234,bench)).toBe(water);}
    const bank={...base,material:'dirt' as const};expect(valleyBench(bank,25,0,1234,bench)).toBe(bank);
    expect(valleyBench(base,200,0,1234,bench)).toBe(base);
  });
  it('reads road datums only at setup and restores deterministic results across seeds',()=>{
    let reads=0;const bench=createValleyBench([],[{x:0,z:0}],()=>{reads++;return 4;});
    const first=bench.at(12,0,1234);bench.at(18,0,5678);expect(bench.at(12,0,1234)).toEqual(first);expect(reads).toBe(1);
  });
  it('has a rounded, wider hill with smooth support fade rather than an abrupt cone cut',()=>{
    const h=(distance:number,support=0)=>islandHill(distance,20,32,.1,support);
    expect(h(0)).toBeGreaterThan(20);expect(h(0)).toBeLessThan(24);expect(h(25)).toBeGreaterThan(2);expect(h(34)).toBe(0);
    expect(Math.abs(h(1)-h(0))).toBeLessThan(.1);expect(h(10,.72)).toBe(0);expect(h(10,.2)).toBeGreaterThan(h(10,.5));
  });
  it('keeps the satellite shore at one block and positive rounded inland relief',()=>{
    expect(isletHeight(20,20,10,.5)).toBe(1);expect(isletHeight(0,20,10,.5)).toBeGreaterThan(8);
    expect(isletHeight(8,20,10,.5)).toBeGreaterThan(isletHeight(16,20,10,.5));
  });
  const shore={height:1,distance:105,landRadius:100,coastWidth:16,shoreWarp:.96,exposure:.1,supportInfluence:0,x:100,z:0,seed:1234,original:'dirt' as const};
  it('uses actual sand in low receding shores and preserves protected material identities',()=>{
    expect(islandSurface(shore)).toBe('sand');expect(islandSurface({...shore,supportInfluence:.2})).toBe('dirt');
    expect(islandSurface({...shore,distance:70,height:4})).toBe('grass');
  });
  it('retains exposed rocky headlands instead of painting all land as sand',()=>{
    const types=new Set<string>();for(let x=60;x<150;x+=2)types.add(islandSurface({...shore,x,exposure:1,distance:105}));expect(types.has('stone')).toBe(true);
  });
});
