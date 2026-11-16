// Shared numeric vectors, not a replacement for source/native shader checks.
export function surfaceMultiplier(position,normal,uniforms){
  const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
  const length=Math.hypot(...normal);
  const facing=smooth(-.45,.75,normal.reduce((sum,n,i)=>sum+n/length*uniforms.blockcolcEffectLightDirection[i],0));
  const brightness=.84+.21*facing;
  const axis=position.map(Math.abs).sort((a,b)=>a-b),edge=1-smooth(.39,.475,axis[1])*uniforms.blockcolcEffectEdgeStrength;
  return uniforms.blockcolcEffectLightTint.map((light,i)=>{
    const tint=uniforms.blockcolcEffectShadowTint[i]*(1-facing)+light*facing;
    return (1+(tint*brightness-1)*uniforms.blockcolcEffectStrength)*edge;
  });
}
export function surfaceCases(){
  const cases=[];
  const positions=[[0,0,0],[.39,.5,0],[.4325,.5,.1],[.475,.5,.1],[-.5,-.475,-.1],[.5,.5,.5],[.3899,.5,.1]];
  const normals=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,2,-3]];
  for(const strength of [0,.25,1])for(const edgeStrength of [0,.18,.35])for(const normal of normals)for(const position of positions){
    const uniforms={blockcolcEffectLightDirection:[-.5490700356131889,.6301144276902908,.549070035613189],
      blockcolcEffectLightTint:[1,.8796223968851662,.6172065624120635],
      blockcolcEffectShadowTint:[.14126329113044458,.21952619971859377,.37626212298046485],
      blockcolcEffectStrength:strength,blockcolcEffectEdgeStrength:edgeStrength};
    cases.push({position,normal,uniforms,expected:surfaceMultiplier(position,normal,uniforms)});
  }
  return cases;
}
