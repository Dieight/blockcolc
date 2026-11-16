export function atlasAnimationCode(a,page=0){
  return `${page}/${a.width}/${a.height}/${a.tileCount};`+a.sequences.map(s=>`${s.textureIndex}:${s.totalTicks}:${s.interpolate?1:0}:`+
    s.frames.map(f=>`${f.textureIndex},${f.time}`).join('/')).join(';');
}
export async function atlasRuntimeInput(info,sha){
  const tags=new Map(),pages=[];if(!info)return {tags,pages};
  for(let index=0;index<info.atlas.pages.length;index++){
    const a=info.atlas.pages[index].animationLookup;if(!a)continue;
    const identity=await sha(new TextEncoder().encode(atlasAnimationCode(a,index)));
    tags.set(a.texture,{animationIdentity:identity,animationRole:'frames'});
    tags.set(a.blendTexture,{animationIdentity:identity,animationRole:'blend'});
    pages.push({input:a,identity,page:index,activeTextureIndices:info.active[index]});
  }
  return {tags,pages};
}
