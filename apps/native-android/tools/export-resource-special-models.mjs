import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../../',import.meta.url)),out=process.argv[2];
const extra={boxes:'chestTextureForBlock,DYE_COLORS',figures:'SKULL_TEXTURES,COPPER_IDS',decor:'DYE_RGB',portals:''};
const plugin={name:'special-model-definitions',setup(b){
 b.onResolve({filter:/^@blockcolc\/resource-pack$/},()=>({path:'pixel-decode-not-used-for-geometry',namespace:'model-export'}));
 b.onLoad({filter:/.*/,namespace:'model-export'},()=>({contents:'export function decodeResourcePackSpecialTexture(t){return new Uint8Array(t.width*t.height*4).fill(255)}',loader:'js'}));
 b.onLoad({filter:/resource-special-(boxes|figures|decor|portals)\.ts$/},a=>{const kind=/resource-special-(.+)\.ts$/.exec(a.path)[1];return {contents:readFileSync(a.path,'utf8')+(extra[kind]?'\nexport {'+extra[kind]+'};':''),loader:'ts',resolveDir:path.dirname(a.path)}});
}};
const built=await build({stdin:{contents:`import * as THREE from 'three'; export {THREE}; ${Object.keys(extra).map(k=>`export * as ${k} from './packages/voxel/src/resource-special-${k}.ts';`).join(' ')}`,resolveDir:root},bundle:true,write:false,platform:'node',format:'esm',metafile:true,plugins:[plugin]});
const s=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const textures=new Map(),models={};
function texture(id){if(!textures.has(id))textures.set(id,{resourceId:id,width:64,height:64});return textures.get(id);}
for(const value of s.boxes.chestTextureForBlock.values())for(const suffix of ['','_left','_right'])texture('minecraft:entity/chest/'+value+suffix);
for(const color of ['',...s.boxes.DYE_COLORS])texture('minecraft:entity/shulker/shulker'+(color?'_'+color:''));
for(const value of Object.values(s.figures.SKULL_TEXTURES))texture(value.textureId);for(const [,id]of s.figures.COPPER_IDS)texture(id);
for(const id of ['banner/banner_base','banner/base','decorated_pot/decorated_pot_base','decorated_pot/decorated_pot_side','conduit/base','end_portal/end_portal'])texture('minecraft:entity/'+id);
function capture(key,route,id,state={}){
 const root=new s.THREE.Group(),voxel={x:0,y:0,z:0,materialId:'stone',buildOrder:0,sourceBlockId:id,sourceBlockState:state};
 const handled=route(root,[voxel],[...textures.values()]);if(!handled.has(voxel))throw Error('Source template not handled '+key);
 models[key]=root.children.map(mesh=>{
  const g=mesh.geometry,m=mesh.material,t=m.map;const textureId=t.name.replace(/^blockcolc-special-/, '').replace(/^blockcolc-/, '')||'minecraft:entity/end_portal/end_portal';
  const matrix=new s.THREE.Matrix4();mesh.getMatrixAt(0,matrix);
  return {name:mesh.name,kind:mesh.userData.specialBlockKind,texture:textureId,
   position:Array.from(g.getAttribute('position').array),normal:Array.from(g.getAttribute('normal').array),uv:Array.from(g.getAttribute('uv').array),indices:g.index?Array.from(g.index.array):null,
   transform:matrix.elements,color:[m.color.r,m.color.g,m.color.b],roughness:m.roughness??1,metalness:m.metalness??0,transparent:m.transparent,alphaTest:m.alphaTest,side:m.side,unlit:m.isMeshBasicMaterial===true,
   flipY:t.flipY,minFilter:t.minFilter,magFilter:t.magFilter,mipmaps:t.generateMipmaps,anisotropy:t.anisotropy,wrapS:t.wrapS,wrapT:t.wrapT,castShadow:mesh.castShadow,receiveShadow:mesh.receiveShadow,order:mesh.renderOrder};
 });
}
for(const shape of ['single','left','right'])capture('chest:'+shape,s.boxes.addResourceSpecialBoxes,'minecraft:chest',{facing:'south',type:shape});
capture('shulker',s.boxes.addResourceSpecialBoxes,'minecraft:shulker_box',{facing:'up'});
for(const [id,model]of Object.entries(s.figures.SKULL_TEXTURES))if(!models[model.model])capture(model.model,s.figures.addResourceSpecialFigures,id,{rotation:'0'});
for(const pose of ['standing','running','sitting','star'])capture('copper:'+pose,s.figures.addResourceSpecialFigures,'minecraft:copper_golem_statue',{pose,facing:'north'});
capture('banner',s.decor.addResourceSpecialDecor,'minecraft:white_banner',{rotation:'0'});capture('wall_banner',s.decor.addResourceSpecialDecor,'minecraft:white_wall_banner',{facing:'south'});
capture('pot',s.decor.addResourceSpecialDecor,'minecraft:decorated_pot',{facing:'north'});capture('conduit',s.decor.addResourceSpecialDecor,'minecraft:conduit');
capture('portal',s.portals.addResourceSpecialPortals,'minecraft:end_portal');capture('gateway',s.portals.addResourceSpecialPortals,'minecraft:end_gateway');
const sourceHashes={};for(const f of Object.keys(built.metafile.inputs)){if(f.startsWith('model-export:')||f==='<stdin>')continue;const full=path.resolve(f),rel=path.relative(root,full).replaceAll('\\','/');if(rel.startsWith('../'))throw Error('Source escaped copy');sourceHashes[rel]=createHash('sha256').update(readFileSync(full)).digest('hex');}
export {s,textures,models,sourceHashes};
if(process.argv[1]===fileURLToPath(import.meta.url)){mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'native-resource-special-models.json'),JSON.stringify({schema:1,sourceHashes,models,chests:Object.fromEntries(s.boxes.chestTextureForBlock),skulls:s.figures.SKULL_TEXTURES,copper:Object.fromEntries(s.figures.COPPER_IDS),dyes:s.decor.DYE_RGB}));console.log(JSON.stringify({templates:Object.keys(models).length,parts:Object.values(models).flat().length,sourceFiles:Object.keys(sourceHashes).length}));}
