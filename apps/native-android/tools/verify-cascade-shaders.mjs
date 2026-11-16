import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createValleyWaterfallMesh} from '../../../packages/voxel/src/terrain-waterfalls.ts';
import {captureMaterialProgram} from './material-program.mjs';

const output=process.argv[2];if(!output)throw Error('Choose a new output directory');
await mkdir(output,{recursive:false});
const example=JSON.parse(await readFile(new URL('./fixtures/reviewed-environment-programs.json',import.meta.url))).programs[0];
const mesh=createValleyWaterfallMesh([{axis:'x',line:0,start:-2,end:2,top:6,bottom:0,direction:1}],{value:0});
const actual=captureMaterialProgram(mesh.material);
assert.equal(actual.vertex,example.definition.vertex);assert.equal(actual.fragment,example.definition.fragment);
mesh.geometry.dispose();mesh.material.dispose();
const template=await readFile(new URL('../world-filament/src/main/materials/instanced.mat.in',import.meta.url),'utf8');
const begin=actual.fragment.indexOf('vec2 cell='),end=actual.fragment.indexOf('diffuseColor.rgb*=mix(',begin);
const nativeBegin=template.indexOf('float2 cell ='),nativeEnd=template.indexOf('base.rgb *= mix(',nativeBegin);
assert.ok(begin>=0&&end>begin&&nativeBegin>=0&&nativeEnd>nativeBegin,'Cascade shader anchors changed');
const source=actual.fragment.slice(begin,actual.fragment.indexOf(';',end)+1)
  .replaceAll('vCascadeUv','uv').replaceAll('uCascadeClock','elapsed').replaceAll('diffuseColor.rgb','color');
const native=template.slice(nativeBegin,template.indexOf(';',nativeEnd)+1)
  .replaceAll('float2','vec2').replaceAll('getUV0()','uv').replaceAll('base.rgb','color');
const cases=[];for(const x of [-10,-.21,0,.19999,.2,1.75,99.3])for(const y of [-3.1,-.0001,0,.3333,2.7])
  for(const elapsed of [0,.016,.25,1,15.27,1000])cases.push({uv:[x,y],elapsed});
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage();
  const result=await page.evaluate(({source,native,cases})=>{
    const gl=document.createElement('canvas').getContext('webgl2');if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('Float framebuffer unavailable');
    function shader(type,text){const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
    const vertex=shader(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}');
    const programs=[source,native].map(block=>{const p=gl.createProgram();gl.attachShader(p,vertex);gl.attachShader(p,shader(gl.FRAGMENT_SHADER,
      '#version 300 es\nprecision highp float;uniform vec2 uv;uniform float elapsed;out vec4 result;void main(){vec3 color=vec3(1);'+block+'result=vec4(color,1);}'));
      gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;});
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,1,1,0,gl.RGBA,gl.FLOAT,null);
    const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete float framebuffer');
    gl.bindVertexArray(gl.createVertexArray());gl.viewport(0,0,1,1);let maximumDelta=0;const shades=new Set();
    for(const c of cases){const pixels=programs.map(p=>{gl.useProgram(p);gl.uniform2fv(gl.getUniformLocation(p,'uv'),c.uv);gl.uniform1f(gl.getUniformLocation(p,'elapsed'),c.elapsed);
      gl.drawArrays(gl.TRIANGLES,0,3);const pixel=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,pixel);return pixel;});
      for(let k=0;k<3;k++){if(!Number.isFinite(pixels[0][k])||!Number.isFinite(pixels[1][k]))throw Error('Nonfinite cascade output');maximumDelta=Math.max(maximumDelta,Math.abs(pixels[0][k]-pixels[1][k]));}
      shades.add(pixels[0][0].toFixed(2));}
    if(gl.getError()!==gl.NO_ERROR)throw Error('GL operation failed');
    return {cases:cases.length,maximumDelta,shades:[...shades].sort(),renderer:gl.getParameter(gl.RENDERER)};
  },{source,native,cases});
  assert.equal(result.maximumDelta,0);assert.deepEqual(result.shades,['0.72','1.42']);
  const hash=s=>createHash('sha256').update(s).digest('hex');
  const report={...result,sourceSha256:hash(source),nativeSha256:hash(native),completed:true,
    scope:'Actual source and adapted cascade fragment blocks on one float WebGL target; not Filament device pixel parity or P1 completion'};
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error)},null,2));throw error;}
finally{await browser.close();}
