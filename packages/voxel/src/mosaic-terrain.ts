export type MosaicBiome = 'ocean'|'beach'|'plains'|'valley'|'forest'|'badlands'|'snow-mountain'|'glacier';
export interface MosaicSample { biome:MosaicBiome; height:number; material:'grass'|'sand'|'stone'|'water'|'snow'|'ice'|'terracotta'; }
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Fixed cold corner in the default camera, independent of random terrain seed. */
export function mosaicColdDirection(_worldSeed:string):readonly [number,number,number]{
 return[-1,0,0];
}
function hash(seed:number,x:number,z:number){let n=Math.imul(x,374761393)^Math.imul(z,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967295;}
function noise(seed:number,x:number,z:number,scale:number){const u=x/scale,v=z/scale,ix=Math.floor(u),iz=Math.floor(v),a=smooth(0,1,u-ix),b=smooth(0,1,v-iz);return(hash(seed,ix,iz)*(1-a)+hash(seed,ix+1,iz)*a)*(1-b)+(hash(seed,ix,iz+1)*(1-a)+hash(seed,ix+1,iz+1)*a)*b;}

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
/** Fixed nine-region composition; ridged relief and erosion are continuous
 * fields underneath climate surfaces, not nine coloured flat rectangles. */
export function sampleMosaicTerrain(x:number,z:number,seed:number,coreRadius:number):MosaicSample {
  const {u,v}=mosaicGridPosition(x,z,coreRadius);
  const warp=(noise(seed^0x1891,x,z,110)-.5)*.12;
  const a=u+warp,b=v+warp*.6,detail=noise(seed^0x621,x,z,33),broad=noise(seed^0x2891,x,z,94);
  const ridge=1-Math.abs(noise(seed^0x482,x,z,52)*2-1);
  const mountain=smooth(.08,.78,-a)*smooth(.2,.86,-b);
  const ice=smooth(.3,.86,-a)*(1-smooth(.13,.72,Math.abs(b)));
  // 31 is mesa; the lower half of 32 continues it. Never leak this into 23.
  const bad=smooth(.32,.84,-a)*smooth(.42,.95,b)
    +smooth(.77,1.22,b)*(1-smooth(.04,.42,a));
  const ocean=smooth(.18,.7,a)*smooth(.16,.72,-b);
  const inlet=smooth(-.08,.2,a)*smooth(.28,.75,-b)*(1-smooth(.35,.7,Math.abs(a)));
  const rightSea=smooth(.38,.82,a)*(1-smooth(-.15,.18,b));
  const coast=Math.max(ocean,inlet,rightSea);
  // Lower 23 splits between construction transition and dappled woodland, with
  // the upper half opening to warm sea. 33 remains a continuous forest.
  const forest=smooth(.65,1.02,a)*smooth(.04,.36,b);
  const rolling=4+(detail-.5)*5+(broad-.5)*7;
  // Jagged crests: multiple ridged octaves, exposed stone below the snowline.
  const peak=25+ridge*25+Math.pow(1-Math.abs(noise(seed^0x741,x,z,30)*2-1),3)*20;
  const mesa=Math.floor((6+broad*25+detail*9)/4)*4;
  let height=rolling+mountain*peak+ice*(5+detail*6)+Math.min(1,bad)*mesa+forest*(3+ridge*9);
  height=height*(1-coast)+(-4+detail*2)*coast;
  if(coast>.66||height<.4)return{biome:'ocean',height:0,material:'water'};
  if(coast>.44)return{biome:'beach',height:Math.max(1,Math.round(height)),material:'sand'};
  if(mountain>.2)return{biome:'snow-mountain',height:Math.round(height),material:height>20?'snow':'stone'};
  if(ice>.34)return{biome:'glacier',height:Math.round(height),material:detail>.64?'ice':'snow'};
  if(bad>.32)return{biome:'badlands',height:Math.round(height),material:'terracotta'};
  if(forest>.25)return{biome:'forest',height:Math.round(height),material:'grass'};
  // Coastal transition forests occupy 23 without displacing the central bench.
  if(b>.6&&a>.35&&coast<.44&&bad<.15)return{biome:'forest',height:Math.round(height),material:'grass'};
  return{biome:Math.hypot(a,b)>.5?'valley':'plains',height:Math.max(2,Math.round(height)),material:'grass'};
}
