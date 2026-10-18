import {describe,it,expect} from 'vitest';
import {mosaicSeed,mosaicGridPosition} from '../src/mosaic-terrain';
import {planEcotoneTrees,treeSuitability,reefDensity,reefChannel,type TreeInput} from '../src/scenery-ecotones';
describe('shared forest and reef fields',()=>{
  it('retains lower-23 woodland suitability independently of the 33 relief envelope',()=>{
    for(const core of [26,66,120])for(const seed of [1234,mosaicSeed('world-default')]){
      const spacing=mosaicGridPosition(0,0,core).spacing,u=.55,v=.95;
      const q=treeSuitability((u+v)*spacing/Math.SQRT2,(v-u)*spacing/Math.SQRT2,seed,core,8,false);
      expect(q.forest).toBeGreaterThan(q.meadow);expect(treeSuitability(-100,0,seed,core,60,true).conifer).toBe(0);
    }
  });
  const fixture=():TreeInput=>({seed:1234,coreX:0,coreZ:0,coreRadius:66,bounds:{minX:-240,maxX:240,minZ:-240,maxZ:240},
    at:(x,z)=>x>170?{supportY:0,material:'water',water:true}:{supportY:10,material:x< -120?'snow':'grass',water:false},
    supports:(x,z)=>Math.abs(z-140)<6?null:{min:10,max:10},
    occupied:(p,gap=0)=>Math.abs(p.x)<45+p.width/2+gap&&Math.abs(p.z)<45+p.depth/2+gap});
  it('makes stable minimum-spaced candidates without planting on water, construction or unsupported land',()=>{
    const input=fixture(),before=JSON.stringify(input.bounds),a=planEcotoneTrees(input),b=planEcotoneTrees(input);
    expect(a).toEqual(b);expect(a.length).toBeGreaterThan(40);expect(JSON.stringify(input.bounds)).toBe(before);
    expect(a.filter(t=>t.ecotoneSpecies==='poplar').length).toBeGreaterThan(10);
    expect(a.filter(t=>t.ecotoneSpecies==='spruce').length).toBeGreaterThan(10);
    for(const t of a){expect(t.x).toBeLessThanOrEqual(170);expect(Math.abs(t.z-140)).toBeGreaterThanOrEqual(6);expect(Math.abs(t.x)>50||Math.abs(t.z)>50).toBe(true);
      if(t.x< -112)expect(t.ecotoneSpecies).toBe('spruce');
      for(const other of a)if(t!==other)expect(Math.hypot(t.x-other.x,t.z-other.z)).toBeGreaterThanOrEqual(11);
    }
  });
  it('honours empty/blocked supports and does not invent terrain to meet a tree budget',()=>{
    const input=fixture();expect(planEcotoneTrees({...input,at:()=>null})).toEqual([]);
    expect(planEcotoneTrees({...input,occupied:()=>true})).toEqual([]);
    expect(planEcotoneTrees({...input,supports:()=>({min:0,max:8})})).toEqual([]);
  });
  it('does not spend the forest budget outside the visible inner transition in a broad world',()=>{
    const input=fixture(),trees=planEcotoneTrees({...input,bounds:{minX:-620,maxX:620,minZ:-620,maxZ:620},
      at:(x)=>({supportY:10,material:x< -120?'snow':'grass',water:false})});
    const inner=trees.filter(t=>t.ecotoneSpecies==='poplar'&&Math.hypot(t.x,t.z)<220);
    expect(inner.length).toBeGreaterThanOrEqual(25);
  });
  it('keeps density and channel decisions independent of culling-tile coordinates',()=>{
    for(const seed of [17,27,1234])for(let x=-80;x<=80;x+=4)for(let z=-80;z<=80;z+=4){
      const value=reefDensity(seed,x,z,0,0,100,8);expect(value).toBeGreaterThanOrEqual(0);expect(value).toBeLessThanOrEqual(1);
      const origin=40,local=x-origin;expect(reefDensity(seed,local+origin,z,0,0,100,8)).toBe(value);
      expect(reefChannel(seed,local+origin,z)).toBe(reefChannel(seed,x,z));
    }
    expect(reefDensity(27,0,0,0,0,100,8)).toBe(1);expect(reefDensity(27,300,300,0,0,100,8)).toBe(0);
  });
  it('fades before the shallow-water safety cut and retains sufficiently deep areas',()=>{
    expect(reefDensity(27,0,0,0,0,100,5.8)).toBe(0);expect(reefDensity(27,0,0,0,0,100,17)).toBe(0);
    const values=[6,6.5,7,7.5,8].map(depth=>reefDensity(27,0,0,0,0,100,depth));
    expect(values).toEqual([...values].sort((a,b)=>a-b));expect(values[0]).toBeLessThan(.05);expect(values.at(-1)).toBe(1);
  });
  it('has irregular deterministic edges and non-empty sandy passage decisions',()=>{
    const edge=[];for(let angle=0;angle<Math.PI*2;angle+=.05)edge.push(reefDensity(27,Math.cos(angle)*100,Math.sin(angle)*100,0,0,100,8));
    expect(new Set(edge.map(v=>Math.round(v*100))).size).toBeGreaterThan(10);
    const channels=[];for(let x=-100;x<100;x+=3)for(let z=-100;z<100;z+=3)channels.push(reefChannel(27,x,z));
    expect(channels.filter(Boolean).length).toBeGreaterThan(30);expect(channels.filter(Boolean).length).toBeLessThan(channels.length*.5);
  });
});
