const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const smoother=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a));return t*t*t*(t*(t*6-15)+10);};
function hash(seed:number,x:number,z:number){let n=Math.imul(x,374761393)^Math.imul(z,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967295;}
export function mosaicNoise(seed:number,x:number,z:number,scale:number){const u=x/scale,v=z/scale,ix=Math.floor(u),iz=Math.floor(v),a=smooth(0,1,u-ix),b=smooth(0,1,v-iz);return(hash(seed,ix,iz)*(1-a)+hash(seed,ix+1,iz)*a)*(1-b)+(hash(seed,ix,iz+1)*(1-a)+hash(seed,ix+1,iz+1)*a)*b;}

/** Same nine-region composition as the current generator. Shared fields are
 * explicit so relief, climate identity and shoreline need not decide each other. */
export function mosaicFields(x:number,z:number,seed:number,coreRadius:number){
  const spacing=Math.max(116,coreRadius+84),u=(x-z)/Math.SQRT2/spacing,v=(x+z)/Math.SQRT2/spacing;
  const warp=(mosaicNoise(seed^0x1891,x,z,110)-.5)*.12,a=u+warp,b=v+warp*.6;
  const detail=mosaicNoise(seed^0x621,x,z,33),broad=mosaicNoise(seed^0x2891,x,z,94),ridge=1-Math.abs(mosaicNoise(seed^0x482,x,z,52)*2-1);
  const mountain=smooth(.08,.78,-a)*smooth(.2,.86,-b),ice=smooth(.3,.86,-a)*(1-smooth(.13,.72,Math.abs(b)));
  const bad=smooth(.32,.84,-a)*smooth(.42,.95,b)+smooth(.77,1.22,b)*(1-smooth(.04,.42,a));
  const ocean=smooth(.18,.7,a)*smooth(.16,.72,-b);
  const inlet=smooth(-.08,.2,a)*smooth(.28,.75,-b)*(1-smooth(.35,.7,Math.abs(a)));
  const rightSea=smooth(.38,.82,a)*(1-smooth(-.15,.18,b));
  const coast=1-(1-ocean)*(1-inlet)*(1-rightSea),forest=smooth(.65,1.02,a)*smooth(.04,.36,b);
  // The coastal woodland in lower 23 is an explicit composition constraint,
  // separate from the relief envelope of the taller forest in 33.
  const coastalWoodland=smooth(.32,.52,a)*smooth(.55,.85,b)*(1-smooth(.28,.40,coast))*(1-smooth(.12,.20,bad));
  const forestHabitat=Math.max(forest,coastalWoodland);
  const rolling=4+(detail-.5)*5+(broad-.5)*7;
  const peak=25+ridge*25+Math.pow(1-Math.abs(mosaicNoise(seed^0x741,x,z,30)*2-1),3)*20;
  const mesaRaw=6+broad*25+detail*9,mesa=Math.floor(mesaRaw/4)*4;
  const legacyLand=rolling+mountain*peak+ice*(5+detail*6)+Math.min(1,bad)*mesa+forest*(3+ridge*9);
  const legacyPremix=legacyLand*(1-coast)+(-4+detail*2)*coast;
  // Exactly the two continuous tests used by the baseline water selection,
  // before either branch rounds heights or flattens the littoral shelf.
  const shoreField=Math.min(.66-coast,(legacyPremix-.4)/24);
  const cold=Math.max(mountain,ice),hot=clamp(bad);
  const total=cold+hot,climateRatio=cold/(total+.0001);
  // The meeting envelopes can both be weak. Comparing their raw magnitudes
  // erased the fringe exactly at that junction; compare their relative share.
  const coldHotBorder=(1-smooth(.12,.32,Math.abs(climateRatio-.5)))*smooth(.10,.30,total);
  return {a,b,spacing,detail,broad,ridge,mountain,ice,bad:hot,forest,forestHabitat,coast,rolling,peak,mesaRaw,legacyPremix,shoreField,coldHotBorder};
}

let distanceScope='';
const distances=new Map<string,number>();
const DIRECTIONS=Array.from({length:16},(_,i)=>[Math.cos(i*Math.PI/8),Math.sin(i*Math.PI/8)] as const);
/** Bounded distance search uses the same wet predicate, avoiding remote
 * depth bands caused by dividing a level value by a nearly zero local slope.
 * Only one seed/radius grid is retained. This is not an exact distance transform. */
export function mosaicShoreDistance(x:number,z:number,seed:number,coreRadius:number):number{
  const scope=`${seed}:${coreRadius}`;
  if(scope!==distanceScope){distances.clear();distanceScope=scope;}
  const cell=(gx:number,gz:number)=>{
    const key=`${gx}:${gz}`,cached=distances.get(key);if(cached!==undefined)return cached;
    const px=gx*8,pz=gz*8;let result=0;
    if(mosaicFields(px,pz,seed,coreRadius).shoreField<0){
      let nearest=48;
      for(const [dx,dz]of DIRECTIONS)for(let t=8;t<=nearest;t+=8){
        if(mosaicFields(px+dx*t,pz+dz*t,seed,coreRadius).shoreField<0)continue;
        let low=t-8,high=t;for(let iteration=0;iteration<4;iteration++){
          const mid=(low+high)/2;if(mosaicFields(px+dx*mid,pz+dz*mid,seed,coreRadius).shoreField<0)low=mid;else high=mid;
        }nearest=Math.min(nearest,(low+high)/2);break;
      }result=-nearest;
    }
    if(distances.size>=32768)distances.clear();distances.set(key,result);return result;
  };
  const gx=Math.floor(x/8),gz=Math.floor(z/8),u=smooth(0,1,x/8-gx),v=smooth(0,1,z/8-gz);
  return (cell(gx,gz)*(1-u)+cell(gx+1,gz)*u)*(1-v)+(cell(gx,gz+1)*(1-u)+cell(gx+1,gz+1)*u)*v;
}
