import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {atlasAnimationCode} from './atlas-runtime-input.mjs';
const code=buildSync({entryPoints:[fileURLToPath(new URL('../../../packages/voxel/src/atlas-animation.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm'}).outputFiles[0].text;
const {sampleAtlasAnimation}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const hash=b=>createHash('sha256').update(b).digest('hex');
export function atlasAnimationOracle(){
  return [[2,7,11],[2],[7],[]].map(active=>{
    const a={width:4,height:3,tileCount:12,sequences:[{textureIndex:2,totalTicks:7,interpolate:true,frames:[{textureIndex:2,time:2},{textureIndex:3,time:5}]},
      {textureIndex:7,totalTicks:5,interpolate:false,frames:[{textureIndex:7,time:3},{textureIndex:9,time:2}]}],
      pixels:new Uint8Array(48),blendPixels:new Uint8Array(48),texture:{needsUpdate:false},blendTexture:{needsUpdate:false}};
    for(let i=0;i<12;i++){a.pixels[i*4]=i;a.pixels[i*4+2]=i;a.blendPixels[i*4+3]=255;}
    sampleAtlasAnimation(a,0,true,new Set(active));
    const input={schema:1,identity:hash(atlasAnimationCode(a)),texture:0,blendTexture:1,width:4,height:3,tileCount:12,sequences:a.sequences,
      activeTextureIndices:active,lookupPixelsSha256:hash(a.pixels),blendPixelsSha256:hash(a.blendPixels)};
    const steps=[];
    for(const freeze of [false,true,false])for(const elapsed of [-5,0,1,16,49,50,75,99,100,149,150,249,250,349,350,1000,123456]){
      const changed=sampleAtlasAnimation(a,elapsed,freeze,new Set(active));
      steps.push({elapsed,freeze,changed,pixels:[...a.pixels],blend:[...a.blendPixels]});
    }
    return {input,steps};
  });
}
