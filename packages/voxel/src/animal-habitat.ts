import type { BlueprintVoxel } from './blueprint-model';
import { originalStaticShapeForVoxel } from './original-static-shapes';
import { isVisuallyEmptyVanillaBlock } from './resource-empty-blocks';
import { surfaceQuery } from './surface-index';
import type { TerrainSurfaceTable } from './terrain-surface-table';
import { CollisionWorld, type Bounds, type Point, type Solid } from './animal-navigation';

export interface AnimalObstacle {
  id:string; voxels:readonly BlueprintVoxel[]; origin:Point; rotation:number; offset?:{x:number;z:number};
  birthExclusion?:Bounds;
}
interface VoxelEntry {source:AnimalObstacle;index:number}
const softNames=new Set(['torch','soul_torch','redstone_torch','lantern','soul_lantern','grass','short_grass','tall_grass','fern','large_fern',
  'poppy','dandelion','allium','azure_bluet','cornflower','oxeye_daisy','lily_of_the_valley','lily_of_valley','lily_pad','wither_rose','sunflower','lilac','rose_bush','peony',
  'open_eyeblossom','closed_eyeblossom','torchflower','torchflower_crop','pink_petals','wildflowers','leaf_litter','vine','glow_lichen',
  'seagrass','tall_seagrass','kelp','kelp_plant','wheat','carrots','potatoes','beetroots','sugar_cane']);
function softBlock(id:string){const name=id.slice(id.lastIndexOf(':')+1);return softNames.has(name)||/(?:_sapling|_tulip|_orchid|_wall_torch)$/.test(name);}

/** Common original shapes are conservative colliders; unresolved pack shapes
 * remain solid. Never treat planned/unbuilt or decayed-away blocks as walls. */
export function obstacleSolids(source:AnimalObstacle,voxel:BlueprintVoxel,index:number):Solid[] {
  const id=voxel.sourceBlockId??'';
  if(softBlock(id)||isVisuallyEmptyVanillaBlock(voxel))return [];
  const c=Math.cos(source.rotation),s=Math.sin(source.rotation),offset=source.offset??{x:0,z:0};
  return originalStaticShapeForVoxel(voxel).boxes.map((b,part)=>{
    const corners=[[b.min[0],b.min[2]],[b.min[0],b.max[2]],[b.max[0],b.min[2]],[b.max[0],b.max[2]]].map(([x,z])=>{
      const px=voxel.x+x!+offset.x,pz=voxel.z+z!+offset.z;
      return [source.origin.x+px*c+pz*s,source.origin.z-px*s+pz*c];
    });
    return {id:`${source.id}:${index}:${part}`,owner:source.id,minX:Math.min(...corners.map(p=>p[0]!)),maxX:Math.max(...corners.map(p=>p[0]!)),
      minZ:Math.min(...corners.map(p=>p[1]!)),maxZ:Math.max(...corners.map(p=>p[1]!)),minY:source.origin.y+voxel.y+b.min[1],maxY:source.origin.y+voxel.y+b.max[1],
      walkable:!/(?:fence|wall|pane|bars)/.test(id),water:/(?:^|:)water$/.test(id)};
  });
}

export class AnimalHabitat {
  readonly world:CollisionWorld;
  readonly query:ReturnType<typeof surfaceQuery>;
  readonly landSeeds:Point[]=[];
  readonly waterSeeds:Point[]=[];
  ready=false;
  indexedVoxels=0;
  private columns=new Map<string,VoxelEntry[]>();
  private shapes=new Map<VoxelEntry,Solid[]>();private shapeCount=0;
  private work:Generator<void>|null;
  constructor(readonly surfaces:TerrainSurfaceTable,readonly bounds:Bounds,readonly sources:readonly AnimalObstacle[],readonly center:Point) {
    this.query=surfaceQuery(surfaces);
    this.world=new CollisionWorld(bounds,[],b=>this.query(b).map<Solid>((s,i)=>({id:`ground:${i}`,owner:'ground',minX:s.minX,maxX:s.maxX,minZ:s.minZ,maxZ:s.maxZ,
      minY:-2048,maxY:s.supportY-.5,water:s.water})).concat(this.structureQuery(b)));
    this.work=this.prepare();
  }
  /** One bounded slice in the existing visible-world pump, after first-frame
   * preparation. No full terrain copy or cold-start collision build. */
  advance(budgetMs=1.5):boolean {
    if(!this.work)return false;
    const began=performance.now();let done=false;
    do {done=!!this.work.next().done;}while(!done&&performance.now()-began<budgetMs);
    if(done){this.work=null;this.ready=true;}return true;
  }
  cancel(){this.work?.return(undefined);this.work=null;}
  stats(){return {indexedColumns:this.columns.size,cachedShapes:this.shapeCount,cachedVoxels:this.shapes.size};}
  private *prepare():Generator<void> {
    // Keep only a bounded collection of useful birthplaces; this is not an
    // activity boundary. A walker can keep choosing goals across the whole map.
    let row=0,landSeen=0,waterSeen=0;
    const offer=(list:Point[],p:Point,seen:number)=>{
      if(list.length<128)list.push(p);
      else {const slot=Math.floor(randomUnit(seen*31+row)*seen);if(slot<128)list[slot]=p;}
    };
    for(const s of this.surfaces){
      row++;
      const x=(s.minX+s.maxX)/2,z=(s.minZ+s.maxZ)/2;
      // Avoid a sparse far-LOD tile producing the entire initial population far
      // beyond the normal view. Habitat roaming itself has no district fence.
      if(Math.abs(x-this.center.x)<160&&Math.abs(z-this.center.z)<160){
        const p={x:Math.round(x),y:s.supportY-.5,z:Math.round(z)};
        if(s.water)offer(this.waterSeeds,p,++waterSeen);
        else if(s.material==='grass'&&!this.sources.some(source=>{
          const b=source.birthExclusion;return b&&p.x>=b.minX&&p.x<=b.maxX&&p.z>=b.minZ&&p.z<=b.maxZ;
        }))offer(this.landSeeds,p,++landSeen);
      }
      if(row%128===0)yield;
    }
    for(const source of this.sources){
      const c=Math.cos(source.rotation),s=Math.sin(source.rotation),offset=source.offset??{x:0,z:0};
      for(let i=0;i<source.voxels.length;i++){
        const voxel=source.voxels[i]!;this.indexedVoxels++;
        if(!softBlock(voxel.sourceBlockId??'')&&!isVisuallyEmptyVanillaBlock(voxel)){
          const x=source.origin.x+(voxel.x+offset.x)*c+(voxel.z+offset.z)*s,z=source.origin.z-(voxel.x+offset.x)*s+(voxel.z+offset.z)*c;
          const key=`${Math.floor(x)}:${Math.floor(z)}`;let list=this.columns.get(key);if(!list)this.columns.set(key,list=[]);
          list.push({source,index:i});
        }
        if(i%128===127)yield;
      }
      yield;
    }
    const distance=(p:Point)=>Math.hypot(p.x-this.center.x,p.z-this.center.z);
    const birthScore=(p:Point)=>distance(p)+(p.x-this.center.x+p.z-this.center.z<0?18:0);
    this.landSeeds.sort((a,b)=>birthScore(a)-birthScore(b));this.waterSeeds.sort((a,b)=>distance(a)-distance(b));
  }
  private structureQuery(b:Bounds):Solid[] {
    const result:Solid[]=[];
    for(let z=Math.floor(b.minZ-2);z<=Math.floor(b.maxZ+2);z++)for(let x=Math.floor(b.minX-2);x<=Math.floor(b.maxX+2);x++){
      for(const entry of this.columns.get(`${x}:${z}`)??[]){
        let solids=this.shapes.get(entry);
        if(solids){this.shapes.delete(entry);this.shapes.set(entry,solids);}
        else {
          solids=obstacleSolids(entry.source,entry.source.voxels[entry.index]!,entry.index);
          if(solids.length<=8192){
            while(this.shapeCount+solids.length>8192&&this.shapes.size){const oldest=this.shapes.keys().next().value!;
              this.shapeCount-=this.shapes.get(oldest)!.length;this.shapes.delete(oldest);}
            this.shapes.set(entry,solids);this.shapeCount+=solids.length;
          }
        }
        for(const s of solids)if(s.minX<b.maxX&&s.maxX>b.minX&&s.minZ<b.maxZ&&s.maxZ>b.minZ)result.push(s);
      }
    }
    return result;
  }
  waterAt(x:number,z:number):number|undefined {
    const rows=this.query({minX:x-.01,maxX:x+.01,minZ:z-.01,maxZ:z+.01});
    let water=-Infinity,land=-Infinity;
    for(const s of rows)if(x>=s.minX&&x<=s.maxX&&z>=s.minZ&&z<=s.maxZ){if(s.water)water=Math.max(water,s.supportY-.5);else land=Math.max(land,s.supportY-.5);}
    return Number.isFinite(water)&&land<water+.01?water:undefined;
  }
  flightFloor(x:number,z:number):number {
    return this.world.query({minX:x-.3,maxX:x+.3,minZ:z-.3,maxZ:z+.3}).reduce((y,s)=>Math.max(y,s.maxY),this.center.y);
  }
  swimClear(p:Point):boolean {
    const water=this.waterAt(p.x,p.z);
    if(water===undefined||p.y>water-.04||p.y<water-1.7)return false;
    for(const [dx,dz] of [[-.32,-.32],[.32,.32],[-.32,.32],[.32,-.32]])if(this.waterAt(p.x+dx!,p.z+dz!)===undefined)return false;
    return this.obstacleClear(p);
  }
  obstacleClear(p:Point):boolean {
    return !this.world.query({minX:p.x-.25,maxX:p.x+.25,minZ:p.z-.25,maxZ:p.z+.25})
      .some(s=>!s.water&&s.maxY>p.y-.16&&s.minY<p.y+.16);
  }
}

export function randomUnit(seed:number):number {
  let n=Math.imul(seed^0x9e3779b9,0x21f0aaad);n=Math.imul(n^(n>>>15),0x735a2d97);return ((n^(n>>>15))>>>0)/4294967296;
}
