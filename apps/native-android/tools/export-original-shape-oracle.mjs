import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];assert(output,'Original-shape oracle directory required');
const hashes={},sha=b=>createHash('sha256').update(b).digest('hex');
const plugin={name:'expose-formal-original-box-mesher',setup(b){b.onLoad({filter:/[\\/]voxel[\\/]src[\\/]original-static-shapes\.ts$/},args=>({
 contents:readFileSync(args.path,'utf8')+'\nexport {VANILLA_SHAPE_PATHS as oracleRegistry,createGeometryFromBoxes as oracleBoxes};',loader:'ts',resolveDir:path.dirname(args.path)
}));}};
const compiled=await build({entryPoints:[path.join(root,'packages/voxel/src/original-static-shapes.ts')],bundle:true,write:false,platform:'node',format:'esm',metafile:true,preserveSymlinks:true,plugins:[plugin]});
for(const input of Object.keys(compiled.metafile.inputs)){const absolute=path.resolve(input),name=path.relative(root,absolute).replaceAll('\\','/');assert(!name.startsWith('../'));hashes[name]=sha(readFileSync(absolute));}
const source=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const registry=Object.fromEntries(Object.entries(source.oracleRegistry).map(([family,ids])=>[family,[...ids]]));
if(process.argv[3]==='--registry-only'){
 mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'original-shape-registry.json'),JSON.stringify({schema:1,
  sourceSha:sha(readFileSync(path.join(root,'packages/voxel/src/original-static-shapes.ts'))),families:Object.entries(registry).map(([id,blocks])=>({id,blocks}))}));
 console.log(JSON.stringify({families:Object.keys(registry).length,blockIds:Object.values(registry).reduce((n,v)=>n+v.length,0)}));process.exit(0);
}
const geometries=[],byBoxes=new Map(),plans=[];
// JSON otherwise loses -0 from quarter-turn boxes. Preserve it in the test
// input so complete upload-byte comparisons do not hide a winding/input bug.
const point=p=>p.map(n=>Object.is(n,-0)?'-0':n);
function geometry(boxes){
 const encoded=boxes.map(b=>({min:point(b.min),max:point(b.max)}));
 const key=JSON.stringify(encoded);if(byBoxes.has(key))return byBoxes.get(key);
 const g=source.oracleBoxes(boxes),attributes={};
 for(const name of ['position','normal','uv']){const a=g.getAttribute(name);assert(a.array instanceof Float32Array);attributes[name]={itemSize:a.itemSize,length:a.array.length,sha:sha(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength))};}
 const index=geometries.length;byBoxes.set(key,index);
 geometries.push({boxes:encoded,attributes,bounds:attributes.position.length?[point(g.boundingBox.min.toArray()),point(g.boundingBox.max.toArray())]:null});g.dispose();return index;
}
const defaults={carpet:{},'pale-moss-carpet':{bottom:'true',north:'none',east:'none',south:'none',west:'none'},lever:{face:'floor',facing:'north',powered:'false'},
 lantern:{hanging:'false',waterlogged:'false'},candle:{candles:'1',lit:'false',waterlogged:'false'},bed:{facing:'north',occupied:'false',part:'head'},
 sign:{rotation:'0',waterlogged:'false'},'wall-sign':{facing:'north',waterlogged:'false'},'hanging-sign':{attached:'false',rotation:'0',waterlogged:'false'},'wall-hanging-sign':{facing:'north',waterlogged:'false'},
 stairs:{facing:'north',half:'bottom',shape:'straight'},slab:{type:'bottom'},fence:{north:'false',east:'false',south:'false',west:'false'},wall:{up:'true',north:'none',east:'none',south:'none',west:'none'},
 pane:{north:'false',east:'false',south:'false',west:'false'},'iron-bars':{north:'false',east:'false',south:'false',west:'false'},door:{facing:'north',open:'false',hinge:'left',half:'lower'},
 trapdoor:{facing:'north',open:'false',half:'bottom'},ladder:{facing:'north'},'fence-gate':{facing:'north',in_wall:'false',open:'false',powered:'false'},
 button:{face:'floor',facing:'north',powered:'false'},'pressure-plate':{powered:'false'},'weighted-pressure-plate':{power:'0'}};
assert.deepEqual(Object.keys(registry).sort(),Object.keys(defaults).sort());
const seenPlans=new Set();
function plan(id,state){
 const input={sourceBlockId:id,...(state===undefined?{}:{sourceBlockState:state})},key=JSON.stringify(input);if(seenPlans.has(key))return;seenPlans.add(key);
 const value=source.originalStaticShapeForVoxel(input);
 const components=value.kind==='original-approximation'?(value.components??[{key:value.family,topologyKey:value.topologyKey,boxes:value.boxes,transform:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],bounds:value.bounds}]):[];
 plans.push({input,result:value,meshes:components.map(c=>geometry(c.boxes))});
}
function combinations(fields,visit,entry={}){const [[key,values],...tail]=fields;if(key===undefined){visit(entry);return;}for(const value of values)tail.length?combinations(tail,visit,{...entry,[key]:value}):visit({...entry,[key]:value});}
const bool=['false','true'],facings=['north','east','south','west'],sides=['north','east','south','west'];
for(const [family,ids]of Object.entries(registry)){
 for(const id of ids)plan('minecraft:'+id,defaults[family]);
 let fields=[];
 switch(family){
  case 'stairs':fields=[['facing',facings],['half',['bottom','top']],['shape',['straight','inner_left','inner_right','outer_left','outer_right']]];break;
  case 'slab':fields=[['type',['bottom','top','double']],['waterlogged',bool]];break;
  case 'fence':case 'pane':case 'iron-bars':fields=sides.map(side=>[side,bool]);break;
  case 'wall':case 'pale-moss-carpet':fields=[[family==='wall'?'up':'bottom',bool],...sides.map(side=>[side,['none','low','tall']])];break;
  case 'door':fields=[['facing',facings],['open',bool],['hinge',['left','right']],['half',['lower','upper']]];break;
  case 'trapdoor':fields=[['facing',facings],['open',bool],['half',['bottom','top']]];break;
  case 'ladder':case 'wall-sign':case 'wall-hanging-sign':fields=[['facing',facings]];break;
  case 'button':case 'lever':fields=[['facing',facings],['face',['floor','wall','ceiling']],['powered',bool]];break;
  case 'fence-gate':fields=[['facing',facings],['open',bool],['in_wall',bool],['powered',bool]];break;
  case 'candle':fields=[['candles',['1','2','3','4']],['lit',bool],['waterlogged',bool]];break;
  case 'lantern':fields=[['hanging',bool],['waterlogged',bool]];break;
  case 'bed':fields=[['facing',facings],['occupied',bool],['part',['head','foot']]];break;
  case 'sign':fields=[['rotation',Array.from({length:16},(_,i)=>String(i))]];break;
  case 'hanging-sign':fields=[['rotation',Array.from({length:16},(_,i)=>String(i))],['attached',bool]];break;
  case 'pressure-plate':fields=[['powered',bool]];break;
  case 'weighted-pressure-plate':fields=[['power',Array.from({length:16},(_,i)=>String(i))]];break;
 }
 if(fields.length)combinations(fields,state=>plan('minecraft:'+ids[0],{...defaults[family],...state}));
 if(family==='lantern')for(const hanging of bool)plan('minecraft:soul_lantern',{hanging,waterlogged:'false'});
 if(family==='bed')for(const facing of facings)for(const part of ['head','foot'])plan('minecraft:straw_bed',{facing,part,occupied:'false'});
 // Invalid cases are retained for the next state-planner layer, not silently
 // converted to accepted box models by this geometry-only oracle.
 plan('minecraft:'+ids[0],undefined);plan('minecraft:'+ids[0],{...defaults[family],bogus:'true'});
 plan('minecraft:'+ids[0],null);plan('minecraft:'+ids[0],[]);
 plan('minecraft:'+ids[0],Object.fromEntries(Object.entries(defaults[family]).map(([k,v])=>[k.toUpperCase(),v.toUpperCase()])));
 const first=Object.keys(defaults[family])[0];if(first)plan('minecraft:'+ids[0],{...defaults[family],[first]:'not-a-valid-value'});
}
for(const id of [undefined,'','mod:oak_stairs','minecraft:unknown_stairs','oak_stairs',' MINECRAFT:OAK_STAIRS ','\ufeff OAK_STAIRS \u00a0','\u001c oak_stairs'])plan(id,{facing:'north',half:'bottom',shape:'straight'});
const box=(min,max)=>({min,max});
for(const boxes of [[],[box([-.5,-.5,-.5],[.5,.5,.5])],
 [box([-.5,-.5,-.5],[0,.5,.5]),box([0,-.5,-.5],[.5,.5,.5])],
 [box([-.5,-.5,-.5],[.5,.25,.5]),box([-.25,0,-.25],[.75,.75,.75])],
 [box([-.5,-.5,-.5],[.5,-.5,.5])],
 [box([-.4999,-.125,.00001],[.333333,.5625,1.125]),box([.1,-.5,.2],[.3,.8,.4])]])geometry(boxes);
for(const name of ['apps/native-android/tools/export-original-shape-oracle.mjs','package-lock.json'])hashes[name]=sha(readFileSync(path.join(root,name)));
mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'original-shape-oracle.json'),JSON.stringify({schema:1,sourceHashes:hashes,registry,plans,geometries}));
console.log(JSON.stringify({families:Object.keys(registry).length,blockIds:Object.values(registry).reduce((n,v)=>n+v.length,0),plans:plans.length,geometries:geometries.length,
 vertices:geometries.reduce((n,g)=>n+g.attributes.position.length/3,0),sources:Object.keys(hashes).length}));
