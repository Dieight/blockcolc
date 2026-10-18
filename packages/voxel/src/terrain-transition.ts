type Sample={height:number;supportInfluence:number;waterKind:string};
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

/** V4 near/middle transition: join the 2-unit edge to its real 4-unit neighbour.
 * This does not fill water or touch foundations. It is not an extra skirt. */
export function blendNearTransition<T extends Sample>(sample:T,x:number,z:number,boundary:number,
  sampleRaw:(x:number,z:number)=>T):T{
  if(sample.waterKind!=='none'||sample.supportInfluence>=.18)return sample;
  const wx=smooth(boundary-16,boundary-1,Math.abs(x)),wz=smooth(boundary-16,boundary-1,Math.abs(z));
  if(wx===0&&wz===0)return sample;
  const snap=(v:number)=>Math.floor(v/4)*4+2;
  const targets:{weight:number;height:number}[]=[];
  for(const [weight,cx,cz]of [[wx,Math.sign(x)*(boundary+2),snap(z)],[wz,snap(x),Math.sign(z)*(boundary+2)]] as const){
    if(weight===0)continue;const other=sampleRaw(cx,cz);
    if(other.waterKind==='none'&&other.supportInfluence<.18)targets.push({weight,height:other.height});
  }
  let sum=0,total=0,blend=0;
  for(const target of targets){const other=targets.length===2?targets.find(t=>t!==target)!.weight:0;
    const weight=target.weight===1&&other===1?1:target.weight*(1-other);
    sum+=target.height*weight;total+=weight;blend=Math.max(blend,target.weight);}
  return total>0?{...sample,height:Math.round(sample.height*(1-blend)+sum/total*blend)}:sample;
}
