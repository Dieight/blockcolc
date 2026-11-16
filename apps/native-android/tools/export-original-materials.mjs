import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,realpathSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];assert(output,'Native original material output required');
const hashes={},sha=b=>createHash('sha256').update(b).digest('hex');
const plugin={name:'expose-source-original-material-data',setup(b){b.onLoad({filter:/[\\/]voxel[\\/]src[\\/]fallback-visual\.ts$/},args=>({
 contents:readFileSync(args.path,'utf8')+`\nexport {BASE_COLORS,DYE_COLORS,WOOD_COLORS,TERRACOTTA_COLORS,CORAL_COLORS};
 export {ORIGINAL_MATERIAL_PATTERNS,createOriginalMaterialTexture,builtinMaterialBlockId,originalPatternForBlockId,originalPatternForMaterialId} from './original-materials';
 export {MATERIAL_RESPONSES,materialResponseForVoxel,materialResponseForMaterialId,materialResponseCode} from './material-response';`,loader:'ts',resolveDir:path.dirname(args.path)
}));}};
const compiled=await build({entryPoints:[path.join(root,'packages/voxel/src/fallback-visual.ts')],bundle:true,write:false,platform:'node',format:'esm',metafile:true,plugins:[plugin]});
for(const input of Object.keys(compiled.metafile.inputs)){const absolute=path.resolve(input),name=path.relative(root,absolute).replaceAll('\\','/');assert(!name.startsWith('../'));hashes[name]=sha(readFileSync(absolute));}
const source=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
for(const name of ['apps/native-android/tools/export-original-materials.mjs','package-lock.json'])hashes[name]=sha(readFileSync(path.join(root,name)));
if(process.argv[3]==='--oracle'){
 const directory=path.join(root,'apps/native-android/world-core/build/generated/bundled-blueprints/native-blueprints');
 const catalog=JSON.parse(readFileSync(path.join(directory,'catalog.json'),'utf8'));
 const shapes=JSON.parse(readFileSync(path.join(root,'apps/native-android/world-core/build/generated/original-shape-oracle/original-shape-oracle.json'),'utf8'));
 for(const generated of [catalog,shapes])for(const [name,expected]of Object.entries(generated.sourceHashes)){assert.equal(sha(readFileSync(path.join(root,name))),expected,'Stale material input: '+name);hashes[name]=expected;}
 const ids=new Set(Object.values(shapes.registry).flat().map(id=>'minecraft:'+id));
 for(const e of catalog.entries){const bytes=readFileSync(path.join(directory,e.sha256+'.json'));assert.equal(sha(bytes),e.sha256);for(const v of JSON.parse(bytes).voxels)if(v.sourceBlockId)ids.add(v.sourceBlockId);}
 for(const dye of Object.keys(source.DYE_COLORS))for(const kind of ['wool','carpet','concrete','concrete_powder','terracotta','glazed_terracotta','stained_glass','stained_glass_pane','bed','banner','candle','cushion','shulker_box'])ids.add('minecraft:'+dye+'_'+kind);
 for(const wood of Object.keys(source.WOOD_COLORS))for(const kind of ['log','wood','planks','stairs','slab','shelf','bookshelf','button','pressure_plate','fence_gate','door','hanging_sign'])ids.add('minecraft:'+wood+'_'+kind);
 for(const name of ['coal','iron','gold','redstone','diamond','emerald','lapis','copper','quartz'])for(const prefix of ['', 'deepslate_'])ids.add('minecraft:'+prefix+name+'_ore');
 for(const kind of ['tube','brain','bubble','fire','horn'])for(const prefix of ['','dead_'])for(const suffix of ['','_block','_fan','_wall_fan'])ids.add('minecraft:'+prefix+kind+'_coral'+suffix);
 for(const name of ['sea_pickle','red_poplar_leaves','orange_poplar_leaves','yellow_poplar_leaves','red_shrub','shelf_mushroom','red_mushroom','red_mushroom_block','brown_mushroom','brown_mushroom_block','hay_block','sculk','sulfur','cinnabar','basalt','tuff','granite','diorite','calcite','quartz','red_sandstone','sandstone','sand','end_stone','andesite','nether_brick','netherrack','mud_bricks','mud','bricks','prismarine','purpur','obsidian','iron_block','gold_block','netherite_block','cherry_leaves','flowering_azalea_leaves','spruce_leaves','birch_leaves','mangrove_leaves','jungle_leaves','dark_oak_leaves','grass_block','moss','vine','azalea','fern','dirt','podzol','mycelium','soul_soil','farmland','gravel','red_sand','snow','packed_ice','blue_ice','ice','water','bubble_column','lava','unknown_stairs'])ids.add('minecraft:'+name);
 for(const id of [...ids])ids.add(id.replace(/^minecraft:/,'mod:'));
 const materials=['stone','wood','plank','roof','glass','accent','unknown'];
 const cases=[];
 for(const id of [undefined,'',...ids].sort())for(const material of materials){const voxel={materialId:material,...(id===undefined?{}:{sourceBlockId:id})};
  cases.push({voxel,style:source.fallbackVisualStyleForVoxel(voxel),pattern:source.originalPatternForBlockId(id,material),response:source.materialResponseForVoxel(voxel),fluid:source.staticFluidKind(voxel)??null});}
 const components=[];
 for(const c of shapes.plans){const voxel={...c.input,materialId:'accent'};for(const part of c.result.components??[])components.push({voxel,key:part.key,style:source.fallbackVisualStyleForOriginalComponent(voxel,part.key)});}
 for(const id of ['minecraft:candle','minecraft:red_candle','minecraft:straw_bed','mod:red_candle','mod:red_bed','mod:lantern','minecraft:pale_moss_carpet','minecraft:moss_carpet'])for(const key of ['unknown','candle-wax','candle-wick','bed-cover','bed-legs','bed-pillow','bed-straw-base','bed-straw-pillow','lantern-frame','lantern-core-soul','carpet','pale-moss-base','pale-moss-west-tall'])for(const lit of ['true','false']){
  const voxel={materialId:'glass',sourceBlockId:id,sourceBlockState:{lit}};components.push({voxel,key,style:source.fallbackVisualStyleForOriginalComponent(voxel,key)});
 }
 const patterns=source.ORIGINAL_MATERIAL_PATTERNS.map(pattern=>{const t=source.createOriginalMaterialTexture(pattern),image=t.image,bytes=Buffer.from(image.data.buffer,image.data.byteOffset,image.data.byteLength);const result={pattern,sha256:sha(bytes),width:image.width,height:image.height,colorSpace:t.colorSpace,wrapS:t.wrapS,wrapT:t.wrapT,minFilter:t.minFilter,magFilter:t.magFilter,anisotropy:t.anisotropy,generateMipmaps:t.generateMipmaps,flipY:t.flipY};t.dispose();return result;});
 const materialDefaults=['stone','terrainStone','wood','plank','roof','glass','accent','grass','dirt','terrainWater','terrainLava','leaves','vine','path','lamp','unknown'].map(material=>({material,pattern:source.originalPatternForMaterialId(material),response:source.materialResponseForMaterialId(material),block:source.builtinMaterialBlockId(material)??null}));
 const fluids=[undefined,'','0','1','2','3','4','5','6','7','8','9','10','15','16','-1','1.5','1.0','1f','1e0','+1','0x7','0b11','0o7','NaN','Infinity','\ufeff 7\u00a0'].map(level=>({level:level??null,height:source.staticFluidHeight({sourceBlockState:level===undefined?undefined:{level}})}));
 const invalidKeys=['','fallback:ffffff:default:unknown:o','fallback:FFFF00:stone:stone:o','fallback:ffffff:bad:stone:o','fallback:fffffff:stone:stone:o','fallback:ffffff:stone:stone:o:extra'].map(key=>({key,result:source.parseFallbackVisualKey(key)??null}));
 mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'original-material-oracle.json'),JSON.stringify({schema:1,sourceHashes:hashes,cases,components,patterns,materialDefaults,fluids,invalidKeys}));
 console.log(JSON.stringify({styles:cases.length,components:components.length,patterns:patterns.length,sources:Object.keys(hashes).length}));process.exit(0);
}
const entries=[];
mkdirSync(path.join(output,'native-original-materials'),{recursive:true});
for(const pattern of source.ORIGINAL_MATERIAL_PATTERNS){
 const texture=source.createOriginalMaterialTexture(pattern),image=texture.image,bytes=Buffer.from(image.data.buffer,image.data.byteOffset,image.data.byteLength),hash=sha(bytes);
 assert.equal(bytes.length,image.width*image.height*4);assert.equal(image.width,16);assert.equal(image.height,16);
 writeFileSync(path.join(output,'native-original-materials',hash+'.rgba'),bytes);
 entries.push({pattern,sha256:hash,width:image.width,height:image.height,colorSpace:texture.colorSpace,wrapS:texture.wrapS,wrapT:texture.wrapT,
  minFilter:texture.minFilter,magFilter:texture.magFilter,anisotropy:texture.anisotropy,generateMipmaps:texture.generateMipmaps,flipY:texture.flipY});texture.dispose();
}
const tables={};for(const key of ['BASE_COLORS','DYE_COLORS','WOOD_COLORS','TERRACOTTA_COLORS','CORAL_COLORS'])tables[key]=Object.entries(source[key]).map(([name,color])=>({name,color}));
const registry={schema:1,sourceHashes:hashes,tables,responses:Object.entries(source.MATERIAL_RESPONSES).map(([kind,value])=>({kind,...value})),entries};
writeFileSync(path.join(output,'native-original-materials/materials.json'),JSON.stringify(registry));
// Only reclaim obsolete content-addressed bytes inside this generator's exact
// build directory. Alternate evidence outputs and all original assets stay put.
const expected=path.join(root,'apps/native-android/world-core/build/generated/original-materials');
if(path.resolve(output)===expected){
 const folder=realpathSync(path.join(output,'native-original-materials'));
 assert.equal(folder,path.join(realpathSync(root),'apps/native-android/world-core/build/generated/original-materials/native-original-materials'));
 const wanted=new Set(entries.map(e=>e.sha256+'.rgba'));
 for(const entry of readdirSync(folder,{withFileTypes:true}))if(entry.isFile()&&/^[a-f0-9]{64}\.rgba$/.test(entry.name)&&!wanted.has(entry.name))unlinkSync(path.join(folder,entry.name));
}
console.log(JSON.stringify({textures:entries.length,pixelBytes:entries.length*16*16*4,colors:Object.values(tables).reduce((n,t)=>n+t.length,0),sources:Object.keys(hashes).length}));
