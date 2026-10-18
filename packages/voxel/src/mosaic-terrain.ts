import {mosaicFields,mosaicNoise as noise,mosaicShoreDistance} from './mosaic-fields';
export type MosaicBiome = 'ocean'|'beach'|'plains'|'valley'|'forest'|'badlands'|'snow-mountain'|'glacier';
export interface MosaicSample { biome:MosaicBiome; height:number; material:'grass'|'sand'|'stone'|'water'|'snow'|'ice'|'terracotta'; }
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Fixed cold corner in the default camera, independent of random terrain seed. */
export function mosaicColdDirection(_worldSeed:string):readonly [number,number,number]{
 return[-1,0,0];
}
export function mosaicSeed(worldSeed:string):number {let seed=0x811c9dc5;for(let i=0;i<worldSeed.length;i++)seed=Math.imul(seed^worldSeed.charCodeAt(i),0x01000193);return seed>>>0;}
export function mosaicGridPosition(x:number,z:number,coreRadius:number) {
  // Default camera: +X/+Z. u points screen-right, v points screen-down.
  const spacing=Math.max(116,coreRadius+84),u=(x-z)/Math.SQRT2,v=(x+z)/Math.SQRT2;
  return {u:u/spacing,v:v/spacing,spacing};
}
export function mosaicRegionAt(x:number,z:number,coreRadius:number):string {
  const {u,v}=mosaicGridPosition(x,z,coreRadius);
  const col=Math.max(1,Math.min(3,Math.round(u)+2)),row=Math.max(1,Math.min(3,Math.round(v)+2));return`${row}${col}`;
}
/** A continuous climate weight, not a rectangular region boundary. */
export function mosaicWarmSeaWeight(x:number,z:number,coreRadius:number):number {
  const {u,v}=mosaicGridPosition(x,z,coreRadius);
  return smooth(.22,.64,u)*(1-smooth(.06,.40,v));
}
/** Smooth shallow shelves and deeper gullies; the water/support surface stays at zero. */
export function mosaicSeabedHeight(x:number,z:number,seed:number,coreRadius:number):number {
  const {u,v}=mosaicGridPosition(x,z,coreRadius);
  const offshore=smooth(.32,1.25,u)*smooth(-.15,.8,-v);
  const broad=noise(seed^0x62b9,x,z,70),detail=noise(seed^0x19b7,x,z,24);
  const gully=Math.pow(1-Math.abs(noise(seed^0x29ac,x,z,42)*2-1),3);
  const depth=-5.4-offshore*5-broad*1.6+detail*.7-gully*1.4;
  const distance=Math.max(0,-mosaicShoreDistance(x,z,seed,coreRadius));
  const t=Math.max(0,Math.min(1,distance/44)),shore=t*t*t*(t*(t*6-15)+10);
  return -1.1+(depth+1.1)*shore;
}
/** Fixed nine-region composition; ridged relief and erosion are continuous
 * fields underneath climate surfaces, not nine coloured flat rectangles. */
export function sampleMosaicTerrain(x:number,z:number,seed:number,coreRadius:number):MosaicSample {
  const f=mosaicFields(x,z,seed,coreRadius);
  // Wet masks and low beach datums stay independent of the relief union.
  if(f.shoreField<0)return{biome:'ocean',height:0,material:'water'};
  if(f.coast>.40){
    const shelf=1+2*(1-smooth(.40,.66,f.coast)),blend=smooth(.28,.40,f.coast);
    return{biome:'beach',height:Math.max(1,Math.round(f.legacyPremix*(1-blend)+shelf*blend)),material:'sand'};
  }
  const dominant=f.bad/(f.bad+f.mountain+f.ice+.0001);
  const t=Math.max(0,Math.min(1,(dominant-.65)/.30)),mesaBlend=t*t*t*(t*(t*6-15)+10);
  const mesa=f.mesaRaw*(1-mesaBlend)+Math.floor(f.mesaRaw/4)*4*mesaBlend;
  const relief=((f.mountain*f.peak)**4+(f.ice*(5+f.detail*6))**4+(f.bad*mesa)**4+(f.forest*(3+f.ridge*9))**4)**.25;
  const shoreT=Math.max(0,Math.min(1,(f.coast-.08)/.32)),shore=shoreT**3*(shoreT*(shoreT*6-15)+10);
  const height=Math.max(2,Math.round((f.rolling+relief)*(1-shore)+3*shore));
  const rough=(noise(seed^0x55f1,x,z,11)-.5)*.12;
  const scores:[MosaicBiome,number][]=[['snow-mountain',f.mountain],['glacier',f.ice],['badlands',f.bad],['forest',f.forestHabitat]];
  if(f.a>=-.50)scores.push([Math.hypot(f.a,f.b)>.5?'valley':'plains',.20]);
  let biome:MosaicBiome='plains',best=-Infinity;
  for(const [index,[kind,value]]of scores.entries()){
    const score=value+rough*Math.sin(index*2.7+1);if(score>best){best=score;biome=kind;}
  }
  if(biome==='snow-mountain')return{biome,height,material:height>=19+(noise(seed^0x712a,x,z,31)-.5)*8?'snow':'stone'};
  const rock=f.coldHotBorder>.3&&noise(seed^0x219e,x,z,14)>.3;
  if(biome==='glacier')return{biome,height,material:rock?'stone':f.detail>.64?'ice':'snow'};
  if(biome==='badlands')return{biome,height,material:rock?'stone':'terracotta'};
  return{biome,height,material:'grass'};
}
