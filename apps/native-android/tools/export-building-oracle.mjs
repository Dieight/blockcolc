import {buildSync} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];
if(!output)throw Error('Building oracle output required');
const sourceHashes={},sha=b=>createHash('sha256').update(b).digest('hex');
async function load(relative){
 const compiled=buildSync({entryPoints:[path.join(root,relative)],bundle:true,write:false,platform:'node',format:'esm',metafile:true});
 for(const input of Object.keys(compiled.metafile.inputs)){const absolute=path.resolve(input),name=path.relative(root,absolute).replaceAll('\\','/');assert.ok(!name.startsWith('../'));sourceHashes[name]=sha(readFileSync(absolute));}
 return import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
}
const {validateBlueprint}=await load('packages/voxel/src/blueprint-model.ts');
const {conditionVisualForVoxels}=await load('packages/voxel/src/environment.ts');
const {createLocalOcclusionField,blockOcclusionFor,faceOcclusionLevelsFor,packFaceOcclusionLevels}=await load('packages/voxel/src/local-occlusion.ts');
const {planMovingPistonRenderVoxels}=await load('packages/voxel/src/resource-special-piston.ts');
const blueprints=[],cases=[];
function blueprint(name,voxels){
 const bounds={};for(const axis of ['x','y','z']){const values=voxels.map(v=>v[axis]);bounds['min'+axis.toUpperCase()]=Math.min(...values);bounds['max'+axis.toUpperCase()]=Math.max(...values);}
 const raw={schemaVersion:1,id:name,title:name,bounds,voxels},normalized=validateBlueprint(raw);const index=blueprints.length;blueprints.push({input:raw,normalized});return index;
}
function scenario(name,index,projectId,completion,condition){
 const bp=blueprints[index].normalized,display=planMovingPistonRenderVoxels(bp.voxels),prefix=display.displayVoxels.filter(v=>v.buildOrder<=completion);
 const visual=conditionVisualForVoxels(projectId,prefix,condition),field=createLocalOcclusionField(visual.intactVoxels);
 cases.push({name,blueprint:index,projectId,completion,condition,display:display.displayVoxels,
  resolved:display.resolved.map(r=>({sourceIndex:bp.voxels.indexOf(r.sourceVoxel),displayIndex:display.displayVoxels.indexOf(r.displayVoxel)})),
  unresolved:display.unresolved.map(r=>({sourceIndex:bp.voxels.indexOf(r.sourceVoxel),reason:r.reason})),
  intact:visual.intactVoxels,missing:visual.missingVoxels,vines:visual.vines,weathering:visual.weathering,
  occlusion:visual.intactVoxels.map(v=>Math.fround(blockOcclusionFor(v,field))),faceWords:visual.intactVoxels.map(v=>packFaceOcclusionLevels(faceOcclusionLevelsFor(v,field)))});
}
const materials=['stone','wood','plank','roof','glass','accent'],blocks=['stone','oak_planks','glass','oak_leaves','stone_stairs','copper_bars','stone_brick_wall','water'];
const dense=[];for(let x=-3;x<=3;x++)for(let y=0;y<=5;y++)for(let z=-3;z<=3;z++){const i=dense.length;dense.push({x,y,z,materialId:materials[i%6],buildOrder:Math.round(i*10000/293),sourceBlockId:'minecraft:'+blocks[i%blocks.length],sourceBlockState:i%11===0?{}:{test:'state_'+i}});}
dense[0].sourceBlockId='minecraft:oak_sign';dense[0].sign={front:{lines:['中间😀','</quote>','', 'snow'],dyeColor:'lime',glowing:true},back:{lines:[],dyeColor:'black',glowing:false}};
dense[1].sourceBlockId='minecraft:campfire';dense[1].campfire={slots:[{slot:3,itemId:'minecraft:salmon',count:1},{slot:0,itemId:'minecraft:cod',count:64}]};
dense[2].sourceBlockId='minecraft:lantern';dense[2].emissiveKind='lantern';dense[2].emissiveLevel=15;
const denseId=blueprint('dense',dense);
for(const project of ['project-A','项目😀/<>'])for(const completion of [0,1,1799,1800,1801,3800,6500,8800,9999,10000])for(const condition of [10000,7777,0])scenario('dense-'+cases.length,denseId,project,completion,condition);
for(const facing of ['down','up','north','south','west','east'])for(const progress of [0,.25,.5,.75,1])for(const extending of [false,true])for(const source of [false,true])for(const moved of ['stone','piston_head','sticky_piston']){
 const state=moved==='stone'?{blockId:'minecraft:stone'}:{blockId:'minecraft:'+moved,properties:moved==='piston_head'?{facing,type:'sticky',short:'false'}:{facing,extended:'false'}};
 const voxels=[{x:0,y:2,z:0,materialId:'stone',buildOrder:8000,sourceBlockId:'minecraft:moving_piston',sourceBlockState:{facing:'north'},movingPistonMovedState:state,movingPistonPose:{facing,progress,extending,source}}];
 for(const [x,y,z]of [[-1,0,0],[1,0,0],[0,0,-1],[0,0,1],[0,1,0],[-1,2,0],[0,3,1]])voxels.push({x,y,z,materialId:'stone',buildOrder:1000,sourceBlockId:'minecraft:stone'});
 const id=blueprint('piston-'+blueprints.length,voxels);scenario('piston-'+cases.length,id,'活塞😀',10000,cases.length%2?7777:0);
}
for(const variant of ['missing','pose-only','no-pose','head-extra','base-extra','base','tiny','near-one']){
 const v={x:0,y:2,z:0,materialId:'stone',buildOrder:8000,sourceBlockId:'minecraft:moving_piston'};
 if(variant!=='missing'&&variant!=='pose-only')v.movingPistonMovedState={blockId:variant.startsWith('head')?'minecraft:piston_head':'minecraft:piston',properties:{facing:'east',...(variant.startsWith('head')?{type:'default'}:{extended:'false'}),...(variant.endsWith('extra')?{extra:'state'}:{})}};
 if(variant!=='missing'&&variant!=='no-pose')v.movingPistonPose={facing:'up',progress:variant==='tiny'?1e-7:variant==='near-one'?1-1e-7:.5,extending:false,source:true};
 const id=blueprint('special-'+variant,[v,{x:0,y:0,z:0,materialId:'stone',buildOrder:0}]);scenario(variant,id,'特殊/😀',10000,7777);
}
for(const origin of [9007199254740000,-9007199254740000]){
 const id=blueprint('large-'+origin,[{x:origin,y:2,z:origin,materialId:'stone',buildOrder:5000},{x:origin+1,y:0,z:origin+2,materialId:'glass',buildOrder:0}]);
 scenario('large-'+origin,id,'large',10000,0);
}
const numbers=[0,-0,1,-1,0.5,1e-7,1e-6,1e-5,1e7,9007199254740991,-9007199254740991,1-1e-7,1e-20].map(value=>({value,text:String(value)}));
const strings=['','text','中间😀','</quote>','\n\b\t\f\r','\u0000\u001f','\ud800','\udfff','line\u2028next'].map(value=>({value,quoted:JSON.stringify(value)}));
for(const name of ['apps/native-android/tools/export-building-oracle.mjs','package-lock.json'])sourceHashes[name]=sha(readFileSync(path.join(root,name)));
mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'building-oracle.json'),JSON.stringify({schema:1,sourceHashes,blueprints,cases,numbers,strings}));
console.log(JSON.stringify({blueprints:blueprints.length,cases:cases.length,sources:Object.keys(sourceHashes).length}));
