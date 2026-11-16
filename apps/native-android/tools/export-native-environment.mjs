import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.argv[2];assert(output);
const sha=b=>createHash('sha256').update(b).digest('hex');
const sunFile=path.join(root,'node_modules/suncalc/index.js'),sunText=readFileSync(sunFile,'utf8');
const arrays=Object.fromEntries(['moonLon','moonLat'].map(name=>{
 const match=sunText.match(new RegExp('const '+name+' = new Int32Array\\(\\[([\\s\\S]*?)\\]\\);'));assert(match,'SunCalc series changed');
 const numbers=match[1].split(',').map(s=>s.trim()).filter(Boolean).map(Number);assert(numbers.every(Number.isSafeInteger));
 assert.equal(numbers.length,name==='moonLon'?360:300);return[name,numbers];
}));
const main=path.join(output,'main'),test=path.join(output,'test');mkdirSync(main,{recursive:true});mkdirSync(path.join(main,'licenses'),{recursive:true});mkdirSync(test,{recursive:true});
writeFileSync(path.join(main,'native-ephemeris-series.json'),JSON.stringify({schema:1,sourceSha:sha(sunText),...arrays}));
writeFileSync(path.join(main,'licenses/suncalc-bsd.txt'),readFileSync(path.join(root,'node_modules/suncalc/LICENSE')));
if(process.argv.includes('--assets-only'))process.exit(0);
const rendererText=readFileSync(path.join(root,'packages/voxel/src/renderer.ts'),'utf8');
const placementStart=rendererText.indexOf('    const placeBlocks = (group: CloudGroup, groupIndex: number): void => {');
const placementEnd=rendererText.indexOf('    cloudGroups.forEach(placeBlocks);',placementStart);
assert(placementStart>=0&&placementEnd>placementStart,'Formal cloud placement entry changed');
function seedClosure(kind){
 const start=rendererText.indexOf('      const '+(kind==='rain'?'drops':'flakes')+' = Array.from(');
 const end=rendererText.indexOf('      '+kind+'.instanceMatrix.needsUpdate = true;',start);
 assert(start>=0&&end>start,'Formal '+kind+' seed initialization changed');return rendererText.slice(start,end);
}
const rainSeeds=seedClosure('rain'),snowSeeds=seedClosure('snow');
const skyColorsStart=rendererText.indexOf('function updateSkyDomeColors('),skyColorsEnd=rendererText.indexOf('\nfunction setCelestialPosition(',skyColorsStart);
assert(skyColorsStart>=0&&skyColorsEnd>skyColorsStart,'Formal sky gradient entry changed');
const smoothStart=rendererText.indexOf('function smoothstep01('),smoothEnd=rendererText.indexOf('\n}',smoothStart)+2;
assert(smoothStart>=0&&smoothEnd>smoothStart,'Formal sky smoothstep entry changed');
const entry=`import * as THREE from 'three';
 import {cloudGroupsForBudget} from ${JSON.stringify(path.join(root,'packages/voxel/src/cloud-layout.ts'))};
 import {cloudVoxels} from ${JSON.stringify(path.join(root,'packages/voxel/src/cloud-shape.ts'))};
 import {cloudAdvectionSpeed} from ${JSON.stringify(path.join(root,'packages/voxel/src/environment.ts'))};
 import {weatherVisualForWeather} from ${JSON.stringify(path.join(root,'packages/voxel/src/environment.ts'))};
 export * from ${JSON.stringify(path.join(root,'packages/voxel/src/lighting.ts'))};
 export * from ${JSON.stringify(path.join(root,'packages/voxel/src/environment.ts'))};
 export * from ${JSON.stringify(path.join(root,'packages/voxel/src/astronomy.ts'))};
 export * from ${JSON.stringify(path.join(root,'packages/voxel/src/astronomy-visual.ts'))};
 export * from ${JSON.stringify(path.join(root,'packages/voxel/src/cloud-layout.ts'))};
 export * from ${JSON.stringify(path.join(root,'packages/voxel/src/cloud-shape.ts'))};
 export * from ${JSON.stringify(path.join(root,'packages/voxel/src/precipitation-ground.ts'))};
 export * from ${JSON.stringify(path.join(root,'packages/voxel/src/sky-spectacle.ts'))};
 export {QUALITY_PROFILES} from ${JSON.stringify(path.join(root,'packages/voxel/src/quality.ts'))};
 export {mosaicColdDirection} from ${JSON.stringify(path.join(root,'packages/voxel/src/mosaic-terrain.ts'))};
 export {createPlanarQuadUvs} from ${JSON.stringify(path.join(root,'packages/voxel/src/original-materials.ts'))};
 export {THREE};
 const SKY_RADIUS=120;
 ${rendererText.slice(smoothStart,smoothEnd)}
 ${rendererText.slice(skyColorsStart,skyColorsEnd)}
 export function captureSkyVertexColours(state,weather){
   const geometry=new THREE.SphereGeometry(SKY_RADIUS,24,12);
   geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count*3),3));
   const response=weatherVisualForWeather(weather);
   updateSkyDomeColors(geometry,state,response.tint,response.cloudBlend*Math.pow(weather.cloudIntensity,.68)*.78);
   return {geometry,rows:Array.from({length:13},(_,row)=>Array.from(geometry.getAttribute('color').array.subarray(row*25*3,row*25*3+3)))};
 }
 export function captureCloudInstances(cloudBudget,currentWeather,seed,context){
   let state=seed||1;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
   const cloudGroups=cloudGroupsForBudget(cloudBudget,currentWeather,random);
   const cloudShapes=cloudGroups.map(group=>cloudVoxels(group.kind,Math.floor(random()*0x7fffffff)));
   const totalInstances=cloudShapes.reduce((sum,shape)=>sum+shape.length,0),packed=new Float32Array(totalInstances*20);
   const cloudCenters=new Float32Array(totalInstances*2),cloudVelocities=new Float32Array(totalInstances*2),cloudBasePositions=new Float32Array(totalInstances*3);
   const previewMode=cloudBudget.previewMode,cloudBase=context.baseY,localityCenter=new THREE.Vector3(context.centerX,0,context.centerZ);
   const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion();let instanceIndex=0;const groupEnds=[];
   const clouds={setMatrixAt(index,m){packed.set(m.elements,index*20);}};
   ${rendererText.slice(placementStart,placementEnd)}
   cloudGroups.forEach(placeBlocks);
   for(let i=0;i<totalInstances;i++){packed.set(cloudCenters.subarray(i*2,i*2+2),i*20+16);packed.set(cloudVelocities.subarray(i*2,i*2+2),i*20+18);}
   return {packed,groupEnds,randomTail:state};
 }
 export function capturePrecipitationSeeds(isSnow,count,tail,previewMode){
   let state=tail;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
   const packed=new Float32Array(count*20),matrix=new THREE.Matrix4(),rainCount=count,snowCount=count;
   const rain={setMatrixAt(index,m){packed.set(m.elements,index*20);}},snow=rain;let particles;
   if(isSnow){${snowSeeds}particles=flakes;}else{${rainSeeds}particles=drops;}
   for(let i=0;i<count;i++){const p=particles[i];packed.set([p.phase,p.offsetX,p.offsetZ,i],i*20+16);}
   return packed;
 }`;
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',metafile:true});
const source=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const hashes={};for(const file of Object.keys(result.metafile.inputs)){if(file==='<stdin>')continue;const absolute=path.resolve(file);hashes[path.relative(root,absolute).replaceAll('\\','/')]=sha(readFileSync(absolute));}
hashes['packages/voxel/src/renderer.ts']=sha(rendererText);
const ephemeris=[];
for(const year of [1901,1925,1955,1980,2000,2026,2049,2070,2149])for(const month of [0,2,5,8,11]){
 const date=new Date(Date.UTC(year,month,12,7,23,41));
 for(const coordinates of [{latitude:31.2,longitude:121.5},{latitude:0,longitude:0},{latitude:-33.9,longitude:151.2},{latitude:78.2,longitude:15.6}])
  ephemeris.push({time:date.getTime(),coordinates,sun:source.sunPositionAt(date,coordinates),moon:source.moonPositionAt(date,coordinates),lunar:source.moonIlluminationAt(date),state:source.sunStateForAstronomy(date,coordinates)});
}
const local=[];for(const tz of ['UTC','Asia/Shanghai','America/New_York','Australia/Sydney']){
 process.env.TZ=tz;
 for(const month of [0,5,9])for(let minute=0;minute<1440;minute+=17){const date=new Date(2026,month,25,Math.floor(minute/60),minute%60,23);
  local.push({zone:tz,time:date.getTime(),state:source.sunStateForLocalTime(date)});}
}
const weather=[];for(let day=0;day<370;day++){const date=new Date(Date.UTC(2026,0,1+day)).toISOString().slice(0,10);for(const ocean of [false,true])weather.push({date,ocean,state:source.weatherForLocalDate(date,ocean)});}
const planar=[];for(const positions of [
 [0,0,0,0,0,4,4,0,4,4,0,0],
 [-3,2,1,-3,5,1,-3,5,8,-3,2,8,3,2,0,3,5,0,7,5,0,7,2,0],
 [1e5+.125,-3.5,-7,1e5+.125,2.75,-7,1e5+.175,2.75,-7,1e5+.175,-3.5,-7]
]){
 const indices=[];for(let q=0;q<positions.length/3;q+=4)indices.push(q,q+1,q+2,q,q+2,q+3);
 const geometry=new source.THREE.BufferGeometry();geometry.setAttribute('position',new source.THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
 planar.push({positions,indices,position:Array.from(geometry.getAttribute('position').array),normal:Array.from(geometry.getAttribute('normal').array),uv:Array.from(source.createPlanarQuadUvs(positions))});
}
writeFileSync(path.join(test,'native-environment-oracle.json'),JSON.stringify({schema:1,sourceHashes:hashes,ephemeris,local,weather,planar}));
const cloudCases=[];
const views=[
 {previewMode:true,contentWidth:10,contentDepth:8,visibleWidth:128,visibleDepth:128},
 {previewMode:true,contentWidth:64,contentDepth:40,visibleWidth:128,visibleDepth:128},
 {contentWidth:18,contentDepth:18,visibleWidth:32,visibleDepth:32},
 {contentWidth:70,contentDepth:48,visibleWidth:250,visibleDepth:300,normalWidth:140,normalDepth:120},
 {contentWidth:160,contentDepth:190,visibleWidth:1200,visibleDepth:1700,normalWidth:400,normalDepth:450},
 {contentWidth:0,contentDepth:-1,visibleWidth:NaN,visibleDepth:Infinity}
];
for(const view of views)for(const kind of ['clear','cloudy','rain','thunderstorm','mist','snow'])for(const [weatherCloudCount,weatherDensity,cloudIntensity] of [[0,0,0],[6,.45,.75],[12,1,1]])for(const seed of [0,8675309]){
 const weather={kind:kind==='thunderstorm'?'rain':kind,thunderstorm:kind==='thunderstorm',cloudIntensity};
 const input={...view,weatherCloudCount,weatherDensity,weatherKind:weather.kind};
 const budget=source.cloudBudgetForView(input);let state=seed||1;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const groups=source.cloudGroupsForBudget(budget,weather,random);let count=0;const ends=groups.map(g=>count+=g.blocks);
 cloudCases.push({input,weather,seed,budget,groups,nextRandom:random(),speed:source.cloudAdvectionSpeed(weather),
   cuts:[0,.01,.45,.72,1,2].map(density=>({density,count:source.cloudDrawCountForQuality(ends,density)}))});
}
const cloudShapes=[];for(const kind of ['cirrus','cumulus','altocumulus','stratus','storm','bank'])for(const variant of [0,1,-1,12345,2147483647,-2147483648])
 cloudShapes.push({kind,variant,voxels:source.cloudVoxels(kind,variant)});
const cloudPlacements=[];process.env.TZ='UTC';
for(const c of cloudCases.filter(c=>c.seed===8675309&&c.input.weatherCloudCount===12&&
  ((c.input.previewMode&&c.input.contentWidth===10)||c.input.visibleWidth===250||c.input.visibleWidth===1200))){
 const context={centerX:12.5,centerZ:-21.25,baseY:48};const capture=source.captureCloudInstances(c.budget,c.weather,c.seed,context);
 const tints=[0,12].map(hour=>{const time=Date.UTC(2026,9,26,hour),sun=source.sunStateForLocalTime(new Date(time)),color=new source.THREE.Color(sun.cloudColor);
   const weather=source.weatherVisualForWeather(c.weather);if(weather.tint!==null)color.lerp(new source.THREE.Color(weather.tint),weather.cloudBlend);
   return {time,rgb:color.toArray()};});
 cloudPlacements.push({...c,context,groupEnds:capture.groupEnds,total:capture.packed.length/20,tints,randomTail:capture.randomTail,
   prefixes:[.45,.72,1].map(density=>{const visible=source.cloudDrawCountForQuality(capture.groupEnds,density);
    return {density,visible,sha256:sha(Buffer.from(capture.packed.buffer,capture.packed.byteOffset,visible*80))};})});
}
assert.equal(cloudPlacements.length,18);
writeFileSync(path.join(test,'native-cloud-oracle.json'),JSON.stringify({schema:1,sourceHashes:hashes,cases:cloudCases,shapes:cloudShapes,placements:cloudPlacements,
  placementSource:{file:'packages/voxel/src/renderer.ts',sha256:sha(rendererText.slice(placementStart,placementEnd))}}));
const groundInputs=[[],
 [[-8,8,-6,6,-.25,'water'],[-4,2,-3,3,2.333333333333,'grass'],[-1,1,-1,1,6.125,'stone']],
 [[0,.125,0,.125,.125,'grass']],
 [[-2500,2500,-3500,3500,-2.1,'water'],[-8.8,4.2,8.8,15.7,15.3,'stone']],
 [[-5.5,7.75,-9.8,6.25,-12.2,'stone'],[0,0,0,1,100,'grass'],[1,2,1,2,4.2,'grass']],
 [[-2,2,-2,2,167.0000001,'stone'],[-2,2,-2,2,167.0000002,'grass']]
];
const grounds=groundInputs.map(rows=>{
 const surfaces=rows.map(([minX,maxX,minZ,maxZ,supportY,material])=>({minX,maxX,minZ,maxZ,supportY,material}));
 const {data,...metadata}=source.precipitationGroundForSurfaces(surfaces);
 const points=[[-1e4,-1e4],[0,0],[.15,1.2],[1e4,1e4],[metadata.minX,metadata.minZ],[metadata.minX+metadata.spanX*.73,metadata.minZ+metadata.spanZ*.27]];
 return {surfaces,...metadata,sha256:sha(Buffer.from(data.buffer)),samples:points.map(([x,z])=>({x,z,y:source.precipitationGroundAt({...metadata,data},x,z)}))};
});
const precipitationGeometry=[];
for(const snow of [false,true])for(const visual of [0,.2,.65,1]){
 const base=.022+visual*.013;const g=snow?new source.THREE.BoxGeometry(.36,.22,.36).toNonIndexed():new source.THREE.CylinderGeometry(base*.32,base,1.02+visual*.96,4,1);
 const position=Array.from(g.getAttribute('position').array),normal=Array.from(g.getAttribute('normal').array),uv=Array.from(g.getAttribute('uv').array);
 precipitationGeometry.push({snow,visual,position,normal,uv,index:g.index?Array.from(g.index.array):null});
}
const precipitationSeeds=[];
for(const snow of [false,true])for(const preview of [false,true])for(const tail of [0,1,0xffffffff,cloudPlacements[7].randomTail]){
 const count=preview?80:snow?49152:32768,packed=source.capturePrecipitationSeeds(snow,count,tail,preview);
 precipitationSeeds.push({snow,preview,tail,count,sha256:sha(Buffer.from(packed.buffer))});
}
writeFileSync(path.join(test,'native-precipitation-oracle.json'),JSON.stringify({schema:1,sourceHashes:hashes,grounds,geometry:precipitationGeometry,seeds:precipitationSeeds,
 seedSource:{file:'packages/voxel/src/renderer.ts',rainSha256:sha(rainSeeds),snowSha256:sha(snowSeeds)}}));
const twilightRows=[];
for(const zone of ['UTC','Asia/Shanghai','America/New_York'])for(const year of [2000,2017,2026,2040])for(const hour of [0,5,6,7,12,17,18,19,23]){
 process.env.TZ=zone;const date=new Date(year,5,21,hour,13,17),raw=source.sunStateForLocalTime(date);
 let seed=date.getFullYear()*400+Math.floor(date.getTime()/86400000)||1;seed=(Math.imul(seed,1664525)+1013904223)>>>0;
 const variant=seed/4294967296;twilightRows.push({zone,time:date.getTime(),coordinates:null,variant,state:source.twilightPalette(raw,variant)});
}
process.env.TZ='UTC';
for(const coordinates of [{latitude:31.2,longitude:121.5},{latitude:78.2,longitude:15.6}])for(const hour of [0,6,12,18]){
 const date=new Date(Date.UTC(2026,9,26,hour,13,17)),raw=source.sunStateForAstronomy(date,coordinates);
 let seed=date.getFullYear()*400+Math.floor(date.getTime()/86400000)||1;seed=(Math.imul(seed,1664525)+1013904223)>>>0;
 const variant=seed/4294967296;twilightRows.push({zone:'UTC',time:date.getTime(),coordinates,variant,state:source.twilightPalette(raw,variant)});
}
assert.equal(new Set(twilightRows.map(r=>r.variant>.5)).size,2,'Include both red and pink twilight variants');
const skyCases=[];
for(const row of twilightRows.filter((r,i)=>r.coordinates||i%7===0))for(const kind of ['clear','cloudy','rain','thunderstorm','mist','snow'])for(const style of ['normal','floating','cold'])for(const tier of ['low','balanced','high']){
 process.env.TZ=row.zone;const weather=source.weatherForExternalOverride(source.localDateForDate(new Date(row.time)),
  {kind:kind==='thunderstorm'?'rain':kind,thunderstorm:kind==='thunderstorm',cloudIntensity:.72,precipitationIntensity:.4});
 const floating=style==='floating',cold=style==='cold',spectacle=new source.SkySpectacle(floating);
 spectacle.uniforms.bcSkyColdDirection.value.set(...source.mosaicColdDirection('world-default'));
 const density=Math.max(.65,source.QUALITY_PROFILES[tier].starCount/960);spectacle.update(row.state,weather,cold,false,density);
 const uniforms=Object.fromEntries(Object.entries(spectacle.uniforms).map(([k,{value}])=>[k,value?.toArray?value.toArray():value]));
 const colours=source.captureSkyVertexColours(row.state,weather).rows;
 const sun=new source.THREE.Vector3(...row.state.sunPosition).normalize(),moon=new source.THREE.Vector3(...row.state.moonPosition).normalize();
 const moonColour=new source.THREE.Color(row.state.skyHorizonColor).lerp(new source.THREE.Color(0xd7e3ef),row.state.moonVisibility).toArray();
 skyCases.push({zone:row.zone,time:row.time,coordinates:row.coordinates,kind,style,tier,uniforms,colours,sun:sun.toArray(),moon:moon.toArray(),moonColour,
  opacity:source.clearSkyVisibilityForWeather(weather),sunVisible:row.state.sunVisibility>.08&&source.clearSkyVisibilityForWeather(weather)>.08,
  moonVisible:row.state.moonVisibility>.08&&source.clearSkyVisibilityForWeather(weather)>.08});
}
const sphere=new source.THREE.SphereGeometry(120,24,12),plane=new source.THREE.PlaneGeometry(1,1);
const skyGeometry=[sphere,plane].map(g=>({position:Array.from(g.getAttribute('position').array),normal:Array.from(g.getAttribute('normal').array),uv:Array.from(g.getAttribute('uv').array),index:Array.from(g.index.array)}));
writeFileSync(path.join(test,'native-sky-oracle.json'),JSON.stringify({schema:1,sourceHashes:hashes,twilight:twilightRows,cases:skyCases,geometry:skyGeometry,
 gradientSource:{file:'packages/voxel/src/renderer.ts',sha256:sha(rendererText.slice(skyColorsStart,skyColorsEnd))}}));
const fogCases=[];
for(const kind of ['clear','cloudy','rain','mist','snow'])for(const core of [.1,5.9,6,24,110,800])for(const extent of [1,48,720,4096])
 for(const distance of [-1,0,1,18,45,160,1000])for(const ocean of [false,true]){
  fogCases.push({kind,core,extent,distance,ocean,range:source.fogRangeForView(kind,distance,Math.max(core,extent/6),ocean)});
 }
writeFileSync(path.join(test,'native-fog-oracle.json'),JSON.stringify({schema:1,sourceHashes:hashes,cases:fogCases}));
process.stdout.write(JSON.stringify({ephemeris:ephemeris.length,local:local.length,weather:weather.length,planar:planar.length,cloudCases:cloudCases.length,cloudShapes:cloudShapes.length,cloudPlacements:cloudPlacements.length,
 precipitationGrounds:grounds.length,precipitationGeometry:precipitationGeometry.length,precipitationSeeds:precipitationSeeds.length,twilight:twilightRows.length,skyCases:skyCases.length,fogCases:fogCases.length,sourceHashes:Object.keys(hashes).length})+'\n');
