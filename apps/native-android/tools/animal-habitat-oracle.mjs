import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
const bundled=buildSync({entryPoints:[fileURLToPath(new URL('../../../packages/voxel/src/animal-habitat.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {AnimalHabitat,obstacleSolids,randomUnit}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
export function animalHabitatOracle(){
  const bounds={minX:-8,maxX:8,minZ:-8,maxZ:8},center={x:0,y:0,z:0};
  const surfaces=[{minX:-8,maxX:0,minZ:-8,maxZ:8,top:0,grass:true,water:false},
    {minX:0,maxX:8,minZ:-8,maxZ:8,top:.5,water:true,grass:false},
    {minX:3,maxX:5,minZ:2,maxZ:4,top:1,water:false,grass:false},
    {minX:-6,maxX:-4,minZ:-3,maxZ:-1,top:1.5,water:false,grass:true}];
  const voxels=[{x:0,y:0,z:0,materialId:'stone',buildOrder:0,sourceBlockId:'minecraft:stone'},
    {x:1,y:0,z:0,materialId:'wood',buildOrder:0,sourceBlockId:'minecraft:oak_slab',sourceBlockState:{type:'bottom'}},
    {x:0,y:0,z:1,materialId:'wood',buildOrder:0,sourceBlockId:'minecraft:oak_stairs',sourceBlockState:{facing:'east',half:'bottom',shape:'straight'}},
    {x:0,y:1,z:0,materialId:'stone',buildOrder:0,sourceBlockId:'minecraft:poppy'}];
  const sources=[{id:'building:a',origin:{x:-2,y:.5,z:0},rotation:Math.PI/2,offset:{x:0,z:0},voxels}];
  const sourceSurfaces=surfaces.map(s=>({...s,supportY:s.top+.5,material:s.grass?'grass':s.water?'water':'sand'}));
  const habitat=new AnimalHabitat(sourceSurfaces,bounds,sources,center);habitat.advance(Infinity);
  const solids=sources.flatMap(s=>s.voxels.flatMap((v,i)=>obstacleSolids(s,v,i))),queries=[];
  for(const x of [-6,-4,-2,-.6,-.02,0,.6,2,4,7])for(const z of [-3,0,.3,3])for(const y of [-1,.5,1.2,2.4]){
    const p={x,y,z};queries.push({p,water:habitat.waterAt(x,z)??null,flightFloor:habitat.flightFloor(x,z),swimClear:habitat.swimClear(p),obstacleClear:habitat.obstacleClear(p)});
  }
  return {bounds,center,surfaces,solids,landSeeds:habitat.landSeeds,queries,
    random:[0,1,-1,0x7fffffff,0xffffffff,4294967296,12345,-147733].map(seed=>({seed,value:randomUnit(seed)}))};
}
