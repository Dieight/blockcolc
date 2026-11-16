import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const out=path.resolve(process.argv[2]??'');
assert.ok(out.startsWith(path.join(repo,'apps/native-android/world-core/build/generated')+path.sep));
const entry=`import {AnimalHabitat,obstacleSolids} from ${JSON.stringify(path.join(repo,'packages/voxel/src/animal-habitat.ts'))};
import {AnimalCommunity} from ${JSON.stringify(path.join(repo,'packages/voxel/src/animal-behavior.ts'))};
export function collision(source){return source.voxels.flatMap((v,i)=>obstacleSolids(source,v,i));}
export function population(input){
 const habitat=new AnimalHabitat(input.surfaces,input.bounds,input.sources,input.center);habitat.advance(Infinity);
 const community=new AnimalCommunity(habitat,input.style,input.seed);for(const _ of community.populate()){}
 const agents=community.agents.map(({walker,...a})=>a);
 const result={land:habitat.landSeeds,water:habitat.waterSeeds,agents,sequence:community.sequence,time:community.time};
 community.dispose();habitat.cancel();return result;
}`;
const bundle=buildSync({absWorkingDir:repo,stdin:{contents:entry,resolveDir:repo,sourcefile:'native-animal-preparation-reference.ts'},bundle:true,platform:'node',format:'esm',metafile:true,write:false});
const source=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const block=(id,state={})=>({x:0,y:1,z:0,materialId:'stone',stage:'details',buildOrder:0,sourceBlockId:id,...(state?{sourceBlockState:state}:{})});
const voxels=[block('minecraft:stone'),block('minecraft:oak_slab',{type:'bottom'}),block('minecraft:oak_slab',{type:'top'}),
 block('minecraft:water'),block('minecraft:air'),block('minecraft:poppy'),block('minecraft:oak_sapling'),block('minecraft:light'),block('mod:plant_tulip'),
 block('minecraft:moving_piston'),block('minecraft:pitcher_crop',{half:'upper',age:'1'}),block('minecraft:pitcher_crop',{half:'upper',age:'4'}),
 block('minecraft:cobblestone_wall',{up:'false',north:'none',east:'none',west:'none',south:'none'}),block('mod:unknown',null),
 {...block('minecraft:stone'),sourceBlockId:undefined}];
for(const facing of ['north','east','south','west']){
 for(const shape of ['straight','inner_left','inner_right','outer_left','outer_right'])for(const half of ['bottom','top'])voxels.push(block('minecraft:oak_stairs',{facing,shape,half}));
 for(const open of ['false','true'])voxels.push(block('minecraft:oak_fence_gate',{facing,open,in_wall:'false',powered:'false'}));
 for(const open of ['false','true'])voxels.push(block('minecraft:oak_door',{facing,open,hinge:'left',half:'lower'}));
 voxels.push(block('minecraft:ladder',{facing}));
}
voxels.push(block('minecraft:oak_fence',{north:'true',south:'false',east:'true',west:'false'}),block('minecraft:glass_pane',{north:'true',south:'true',east:'false',west:'false'}),
 block('minecraft:iron_bars',{north:'true',south:'false',east:'false',west:'true'}));
const collision=[];
for(const rotation of [0,Math.PI/2,-Math.PI/3,Math.PI]){
 const input={id:'building:source',origin:{x:4.25,y:1.5,z:-3.5},rotation,offset:{x:-2.25,z:.75},voxels};
 collision.push({input,expected:source.collision(input)});
}
const order=['grass','dirt','stone','water','sand','snow','ice','terracotta'];
const surfaces=[];
for(let z=-40;z<40;z+=2)for(let x=-40;x<40;x+=2){
 const water=x>=12,material=water?'water':x<-22?'stone':'grass';
 surfaces.push({minX:x,maxX:x+2,minZ:z,maxZ:z+2,supportY:(water?.5:x<-22?2:0)+.5,material,water});
}
// These distant and half-coordinate rows exercise birth limits and JS rounding.
surfaces.push({minX:-.75,maxX:-.25,minZ:-.75,maxZ:-.25,supportY:.5,material:'grass',water:false},
 {minX:200,maxX:204,minZ:200,maxZ:204,supportY:.5,material:'grass',water:false});
surfaces.sort((a,b)=>order.indexOf(a.material)-order.indexOf(b.material));
const sources=[{id:'building:platform',origin:{x:0,y:.5,z:0},rotation:Math.PI/2,offset:{x:0,z:0},
 birthExclusion:{minX:-5,maxX:5,minZ:-5,maxZ:5},voxels:Array.from({length:9},(_,i)=>({...block('minecraft:stone'),x:i%3-1,y:0,z:Math.floor(i/3)-1}))}];
const populations=[];
for(const style of ['natural-valley','classic-island','ocean-island','mosaic-coast'])for(const seed of [0,12345,4294967295]){
 const input={surfaces,bounds:{minX:-48,maxX:208,minZ:-48,maxZ:208},sources,center:{x:0,y:0,z:0},style,seed};
 populations.push({input,expected:source.population(input)});
}
for(const style of ['natural-valley','classic-island','ocean-island','mosaic-coast']){
 const input={surfaces:[],bounds:{minX:-8,maxX:8,minZ:-8,maxZ:8},sources:[],center:{x:0,y:0,z:0},style,seed:719};
 populations.push({input,expected:source.population(input)});
}
const sourceFiles=[...Object.keys(bundle.metafile.inputs).filter(p=>!p.startsWith('<')&&!p.endsWith('native-animal-preparation-reference.ts')).map(p=>path.resolve(repo,p)),fileURLToPath(import.meta.url),path.join(repo,'package-lock.json')];
const sourceHashes=Object.fromEntries([...new Set(sourceFiles)].sort().map(p=>[path.relative(repo,p).replaceAll('\\','/'),crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-animal-preparation-oracle.json'),JSON.stringify({schema:1,sourceHashes,collision,populations}));
console.log(JSON.stringify({collisionCases:collision.length,sourceVoxels:voxels.length,populations:populations.length}));
