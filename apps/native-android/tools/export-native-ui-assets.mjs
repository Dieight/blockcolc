import {buildSync} from 'esbuild';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];
if(!output)throw Error('Native UI output directory required');
const sourceHashes={};
function track(name){sourceHashes[name]=createHash('sha256').update(readFileSync(path.join(root,name))).digest('hex');}
async function load(name){
 const compiled=buildSync({entryPoints:[path.join(root,name)],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',metafile:true});
 for(const file of Object.keys(compiled.metafile.inputs))track(path.relative(root,path.resolve(file)).replaceAll('\\','/'));
 return import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
}
const {EN}=await load('apps/web/src/messages-en.ts');
const {PixelBrand,PixelIcon,PixelCalendar}=await load('apps/web/src/ui/PixelIcon.tsx');
const {ICON_MOTION_MS,iconPartMotion}=await load('apps/web/src/ui/button-icon-motion.ts');
track('apps/web/src/styles/navigation-motion.css');
const iconSource=readFileSync(path.join(root,'apps/web/src/ui/PixelIcon.tsx'),'utf8');
const literal=iconSource.match(/const glyphs = (\{[\s\S]*?\}) as const;/)?.[1];assert.ok(literal,'Formal glyph declaration changed');
const compiled=buildSync({stdin:{contents:`export default ${literal}`,loader:'ts'},write:false,platform:'node',format:'esm'});
const {default:icons}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
for(const [name,rows] of Object.entries(icons)){
 assert.match(name,/^[a-z]+$/);assert.equal(rows.length,12);assert.ok(rows.every(row=>/^[01]{12}$/.test(row)));
}
const brand=[];
function collect(element){
 if(element==null)return;if(Array.isArray(element)){element.forEach(collect);return;}
 const {type,props}=element;
 if(type==='path'){assert.match(props.fill,/^#[a-fA-F0-9]{6}$/);assert.equal(typeof props.d,'string');assert.match(props.d,/^[MmLlHhVvZz0-9 ,.\-]+$/);brand.push({fill:props.fill,path:props.d});}
 else {assert.ok(type==='svg'||type==='g');collect(props.children);}
}
collect(PixelBrand({size:16}));assert.ok(brand.length>=10);
// Finite layers and keyframes are taken from the actual React SVG and
// production motion function, not a second hand-maintained icon atlas.
const iconMotion={};
for(const name of Object.keys(icons)){
 const element=name==='calendar'?PixelCalendar({size:24}):PixelIcon({name,size:24});
 const layers=[];
 function walk(node,part=''){
  if(!node)return;if(Array.isArray(node)){node.forEach(n=>walk(n,part));return;}
  const {type,props}=node;const next=props['data-icon-part']??part;
  if(type==='path')layers.push({part:next,path:props.d,background:props.fill==='var(--app-bg)'});
  else {assert.ok(type==='svg'||type==='g');walk(props.children,next);}
 }
 walk(element);
 const motions={};for(const part of new Set(layers.map(p=>p.part))){const spec=iconPartMotion(name,part);if(spec)motions[part]=spec;}
 iconMotion[name]={viewBox:element.props.viewBox.split(/ +/).map(Number),layers,motions};
}
assert.equal(ICON_MOTION_MS,900);
const motionSource=readFileSync(path.join(root,'apps/web/src/ui/button-icon-motion.ts'),'utf8');
const closeLiteral=motionSource.match(/ghost\.animate\((\[[\s\S]*?\]),\{duration:(\d+),easing:'([^']+)'\}\)/);
assert.ok(closeLiteral,'Formal close receipt changed');
const closeSpec=buildSync({stdin:{contents:`export default ${closeLiteral[1]}`,loader:'ts'},write:false,platform:'node',format:'esm'});
const closeFrames=(await import('data:text/javascript;base64,'+Buffer.from(closeSpec.outputFiles[0].text).toString('base64'))).default;
iconMotion.close.motions['']={keyframes:closeFrames,origin:'50% 50%',delay:0,duration:Number(closeLiteral[2]),easing:closeLiteral[3]};
track('apps/native-android/tools/export-native-ui-assets.mjs');track('package-lock.json');
const assets=path.join(output,'assets'),res=path.join(output,'res/drawable');mkdirSync(assets,{recursive:true});mkdirSync(res,{recursive:true});
// Native-only account controls extend the shared atlas without changing Web.
Object.assign(icons,{
 back:['000000000000','000001000000','000011000000','000110000000','001100000000','011111111110','011111111110','001100000000','000110000000','000011000000','000001000000','000000000000'],
 info:['000111111000','001000000100','010001100010','100001100001','100000000001','100011100001','100001100001','100001100001','100011110001','010000000010','001000000100','000111111000'],
 eyeopen:['000000000000','000000000000','000011110000','001100001100','010000000010','100001100001','100001100001','010000000010','001100001100','000011110000','000000000000','000000000000'],
 eyeclosed:['000000000000','000000000000','000000000000','000000000000','100000000001','010000000010','001111111100','001001001100','010001000010','000000000000','000000000000','000000000000'],
 friends:['000000000000','011100001110','011100001110','011100001110','000000000000','011100001110','111110011111','111110011111','110110011011','110110011011','000000000000','000000000000']
});
writeFileSync(path.join(assets,'native-ui-assets.json'),JSON.stringify({schema:1,sourceHashes,en:EN,icons,brand,iconMotion}));
writeFileSync(path.join(res,'native_brand.xml'),'<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="32dp" android:height="32dp" android:viewportWidth="16" android:viewportHeight="16">\n'+brand.map(p=>`    <path android:fillColor="${p.fill}" android:pathData="${p.path}"/>`).join('\n')+'\n</vector>\n');
console.log(JSON.stringify({translations:Object.keys(EN).length,icons:Object.keys(icons).length,brandPaths:brand.length,sources:Object.keys(sourceHashes).length}));
