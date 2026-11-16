import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import * as THREE from 'three';
import {applyMaterialEffects} from '../../../packages/voxel/src/material-effects.ts';
import {captureMaterialProgram} from './material-program.mjs';
import {surfaceCases} from './surface-cases.mjs';

const output=process.argv[2];if(!output)throw Error('Choose a new report directory');
await mkdir(output,{recursive:false});
const hash=text=>createHash('sha256').update(text).digest('hex');
const fixture=JSON.parse(await readFile(new URL('./fixtures/reviewed-program.json',import.meta.url),'utf8'));
const material=new THREE.MeshStandardMaterial();applyMaterialEffects(material);
const source=captureMaterialProgram(material);
function effectBlock(text){
  const start=text.indexOf('float blockcolcEffectFacing ='),end=text.indexOf('#include <opaque_fragment>',start);
  if(start<0||end<start)throw Error('Production face-effect anchors changed');
  return text.slice(start,end);
}
const production=effectBlock(source.fragment);
// A source edit must update the reviewed program, not silently keep an adapter.
assert.equal(production,effectBlock(fixture.definition.fragment));
const template=await readFile(new URL('../world-filament/src/main/materials/instanced.mat.in',import.meta.url),'utf8');
const start=template.indexOf('float facing ='),end=template.indexOf('float fogDepth =',start);
if(start<0||end<start)throw Error('Native effect anchors changed');
const native=template.slice(start,end).replaceAll('float3','vec3').replaceAll('float4','vec4')
  .replaceAll('variable_sourceNormal.xyz','vBlockcolcEffectNormal').replaceAll('variable_sourcePosition.xyz','vBlockcolcEffectPosition')
  .replaceAll('materialParams.effectDirection','blockcolcEffectLightDirection')
  .replaceAll('materialParams.effectLightTint','blockcolcEffectLightTint')
  .replaceAll('materialParams.effectShadowTint','blockcolcEffectShadowTint')
  .replaceAll('materialParams.effectEdgeStrength','blockcolcEffectEdgeStrength')
  .replaceAll('materialParams.effectStrength','blockcolcEffectStrength')
  .replace('material.postLightingColor = vec4(multiplier, 1.0);','outgoingLight *= multiplier;');
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage();
  const gpu=await page.evaluate(({blocks,cases})=>{
    const gl=document.createElement('canvas').getContext('webgl2',{antialias:false});
    if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('Float WebGL2 target unavailable');
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,1,1);
    const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Float framebuffer incomplete');
    const common=`uniform vec3 vBlockcolcEffectNormal,vBlockcolcEffectPosition;
      uniform vec3 blockcolcEffectLightDirection,blockcolcEffectLightTint,blockcolcEffectShadowTint;
      uniform float blockcolcEffectStrength,blockcolcEffectEdgeStrength;`;
    const compile=(type,code)=>{
      const shader=gl.createShader(type);gl.shaderSource(shader,code);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;
    };
    const vertex=compile(gl.VERTEX_SHADER,`#version 300 es
      void main(){gl_Position=vec4(float((gl_VertexID<<1)&2)*2.0-1.0,float(gl_VertexID&2)*2.0-1.0,0.0,1.0);}`);
    const reports=[];gl.viewport(0,0,1,1);gl.bindVertexArray(gl.createVertexArray());
    for(const block of blocks){
      const fragment=compile(gl.FRAGMENT_SHADER,`#version 300 es
        precision highp float;${common}out vec4 color;
        void main(){vec3 outgoingLight=vec3(1);${block}\ncolor=vec4(outgoingLight,1);}`);
      const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
      let maxError=0,worstCase=-1;
      for(const [index,test] of cases.entries()){
        for(const [name,value] of Object.entries({...test.uniforms,vBlockcolcEffectNormal:test.normal,vBlockcolcEffectPosition:test.position})){
          const location=gl.getUniformLocation(program,name);
          if(Array.isArray(value))gl.uniform3fv(location,value);else gl.uniform1f(location,value);
        }
        gl.drawArrays(gl.TRIANGLES,0,3);
        const result=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,result);
        if(gl.getError()!==gl.NO_ERROR||!Array.from(result).every(Number.isFinite))throw Error('Invalid GPU result');
        for(let c=0;c<3;c++){const error=Math.abs(result[c]-test.expected[c]);if(error>maxError){maxError=error;worstCase=index;}}
      }
      reports.push({cases:cases.length,maxAbsoluteError:maxError,worstCase});
      gl.deleteProgram(program);gl.deleteShader(fragment);
    }
    gl.deleteShader(vertex);gl.deleteFramebuffer(fb);gl.deleteTexture(texture);
    return {renderer:gl.getParameter(gl.RENDERER),reports};
  },{blocks:[production,native],cases:surfaceCases()});
  for(const result of gpu.reports)assert.ok(result.maxAbsoluteError<2e-5,JSON.stringify(result));
  const report={productionBlockSha256:hash(production),nativeBlockSha256:hash(native),gpu,
    passed:true,scope:'Real WebGL evaluation of source and adapted GLSL numeric operations; not Filament whole-scene visual parity',p1GatePassed:false};
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error)}));throw error;}
finally{await browser.close();}
