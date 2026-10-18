import {mosaicFields as transitionFields} from './mosaic-fields';
import {smooth,random,noise} from './landscape-fields';

export type Species='poplar'|'spruce'|'birch'|'oak';
export interface Ground {supportY:number;water:boolean;material?:string;}
export interface TreeSite {x:number;y:number;z:number;scale:number;ecotoneSpecies:Species;}
export interface TreeInput {
  seed:number;coreX:number;coreZ:number;coreRadius:number;
  bounds:{minX:number;maxX:number;minZ:number;maxZ:number};
  at:(x:number,z:number)=>Ground|null|undefined;
  supports:(x:number,z:number,width:number,depth:number)=>{min:number;max:number}|null;
  occupied:(p:{x:number;z:number;width:number;depth:number},gap?:number)=>boolean;
}
/** Continuous suitability is separate from the categorical material/biome.
 * The explicit lower-23 woodland is kept by transitionFields.forestHabitat. */
export function treeSuitability(x:number,z:number,seed:number,coreRadius:number,height:number,cold:boolean){
  const f=transitionFields(x,z,seed,coreRadius);
  const patches=.58+.42*smooth(.25,.72,noise(seed^0x93ab,x,z,42));
  // Biome competition already calls a .2-strength woodland a forest. Requiring
  // .72 for full tree suitability erased that inner woodland despite keeping
  // the label. Reach mature density earlier, retaining a broad sparse fringe.
  const forest=smooth(.08,.50,f.forestHabitat)*patches;
  const treeline=1-smooth(25,49,height);
  const conifer=(cold?smooth(.02,.40,Math.max(f.ice,f.mountain)):.0)*treeline*patches;
  const meadow=.04+.18*smooth(.44,.76,noise(seed^0x87b1,x,z,55));
  return {forest,conifer,meadow,treeline};
}

/** Stable world-grid candidates with jitter and minimum spacing. This is
 * bounded rejection sampling, not an implementation/complexity claim of
 * Bridson's active-list algorithm. It never uses surface-cell centres. */
export function planEcotoneTrees(input:TreeInput):TreeSite[]{
  const {seed,coreRadius,coreX,coreZ,bounds,at,supports,occupied}=input,cell=11;
  const candidates:{x:number;z:number;priority:number;gx:number;gz:number}[]=[];
  for(let gx=Math.floor(bounds.minX/cell);gx<=Math.ceil(bounds.maxX/cell);gx++)for(let gz=Math.floor(bounds.minZ/cell);gz<=Math.ceil(bounds.maxZ/cell);gz++){
    const x=Math.round((gx+.15+.7*random(seed^0x391,gx,gz))*cell),z=Math.round((gz+.15+.7*random(seed^0x762,gx,gz))*cell);
    if(x<bounds.minX+5||x>bounds.maxX-5||z<bounds.minZ+5||z>bounds.maxZ-5)continue;
    // A world-wide quota plus uniform priority let remote saturated woodland
    // consume the near transition. Prefer the inner composition continuously,
    // without snapping a forest line to a radius or adding more trees.
    const distance=Math.hypot(x-coreX,z-coreZ)/Math.max(116,coreRadius+84);
    candidates.push({x,z,gx,gz,priority:random(seed^0x674a,gx,gz)*(.10+distance**4)});
  }
  candidates.sort((a,b)=>a.priority-b.priority||a.x-b.x||a.z-b.z);
  const placed:TreeSite[]=[],buckets=new Map<string,TreeSite[]>(),counts={poplar:0,spruce:0,birch:0,oak:0};
  const budgets={poplar:160,spruce:90,birch:60,oak:60};
  const near=(x:number,z:number)=>{const rows:TreeSite[]=[];for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)rows.push(...buckets.get(`${Math.floor(x/11)+dx}:${Math.floor(z/11)+dz}`)??[]);return rows;};
  for(const p of candidates){
    const s=at(p.x,p.z);if(!s||s.water||!['grass','snow'].includes(s.material??''))continue;
    const spacing=Math.max(116,coreRadius+84),u=(p.x-coreX-p.z+coreZ)/Math.SQRT2/spacing,v=(p.x-coreX+p.z-coreZ)/Math.SQRT2/spacing;
    const cold=['snow','ice'].includes(s.material??'')||u<-.5&&Math.abs(v)<.5
      ||[[-8,0],[8,0],[0,-8],[0,8],[-6,-6],[-6,6],[6,-6],[6,6]].some(([dx,dz])=>['snow','ice'].includes(at(p.x+dx!,p.z+dz!)?.material??''));
    const q=treeSuitability(p.x-coreX,p.z-coreZ,seed,coreRadius,s.supportY,cold);
    const species:Species=cold?'spruce':q.forest>.06?'poplar':noise(seed^0x318,p.x,p.z,55)>.62?'birch':'oak';
    const density=cold?q.conifer:species==='poplar'?q.forest:q.meadow;
    if(random(seed^0x2d1b,p.gx,p.gz)>density||counts[species]>=budgets[species])continue;
    const footprint=species==='poplar'?9:species==='spruce'?7:5,minSpacing=species==='poplar'?11:12;
    if(near(p.x,p.z).some(t=>{
      const other=t.ecotoneSpecies==='poplar'?9:t.ecotoneSpecies==='spruce'?7:5;
      // Match the renderer planner's crown rectangle as well as trunk spacing,
      // so rejected overlapping crowns do not consume the regional quota.
      return Math.hypot(t.x-p.x,t.z-p.z)<Math.max(minSpacing,t.ecotoneSpecies==='poplar'?11:12)
        ||Math.abs(t.x-p.x)<(footprint+2+other)/2+2&&Math.abs(t.z-p.z)<(footprint+2+other)/2+2;
    })
      ||occupied({x:p.x,z:p.z,width:footprint+2,depth:footprint+2},2))continue;
    const support=supports(p.x,p.z,3,3);if(!support||support.max-support.min>3)continue;
    const tree={x:p.x,z:p.z,y:s.supportY,scale:1,ecotoneSpecies:species};placed.push(tree);counts[species]++;
    const key=`${Math.floor(p.x/11)}:${Math.floor(p.z/11)}`;buckets.set(key,[...buckets.get(key)??[],tree]);
  }
  return placed;
}

/** The shoal remains one world field. Broad domain warping shapes its edge;
 * a separate field cuts sandy passages through coral, not through the seabed. */
export function reefDensity(seed:number,x:number,z:number,centerX:number,centerZ:number,radius:number,depth:number):number{
  const wx=(noise(seed^0x12bf,x,z,61)-.5)*radius*.32,wz=(noise(seed^0x421d,x,z,57)-.5)*radius*.28;
  const dx=(x-centerX+wx)/radius,dz=(z-centerZ+wz)/radius;
  const body=1-Math.hypot(dx+Math.sin(dz*2.8)*.15,dz/.86);
  const lobe=.47-Math.hypot(dx-.62,dz+.25);
  const edge=Math.max(body,lobe)+(noise(seed^0x812a,x,z,25)-.5)*.40+(noise(seed^0x194a,x,z,10)-.5)*.12;
  return smooth(-.10,.25,edge)*smooth(5.8,8.0,depth)*(1-smooth(13,17,depth));
}
export function reefChannel(seed:number,x:number,z:number):boolean{
  const wx=x+(noise(seed^0x554,x,z,65)-.5)*22,wz=z+(noise(seed^0x892,x,z,63)-.5)*22;
  return Math.abs(noise(seed^0x337a,wx,wz,42)-.5)<.024;
}
