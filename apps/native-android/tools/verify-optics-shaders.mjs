import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import * as THREE from 'three';
import {createServer} from 'vite';
import {captureMaterialProgram} from './material-program.mjs';

const output=process.argv[2];if(!output)throw Error('New optics evidence directory required');
await mkdir(output,{recursive:false});
// Use the project's TS resolver: the production module has extensionless imports.
const loader=await createServer({configFile:false,cacheDir:'artifacts/cache/native-optics-loader',
  optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null}});
let SkySpectacle,NIGHT_SKY_GLSL;
try{({SkySpectacle,NIGHT_SKY_GLSL}=await loader.ssrLoadModule('/packages/voxel/src/sky-spectacle.ts'));}
finally{await loader.close();}
const hash=s=>createHash('sha256').update(s).digest('hex');
const field=await readFile(new URL('../world-filament/src/main/materials/night-field.glsl.in',import.meta.url),'utf8');
assert.equal(field.replaceAll('\r\n','\n').trim(),NIGHT_SKY_GLSL.replaceAll('\r\n','\n').trim(),'Night field drifted from the producer');
const m=new THREE.MeshStandardMaterial();new SkySpectacle().patchReflection(m);
const recipe=captureMaterialProgram(m),start=recipe.fragment.indexOf('float bcReflective='),end=recipe.fragment.indexOf('#include <opaque_fragment>',start);
assert.ok(start>=0&&end>start);
const source=`vec3 sourceReflection(float roughnessFactor,vec3 testIncident,vec3 testNormal){vec3 outgoingLight=vec3(0);\n`+
  recipe.fragment.slice(start,end).replace('inverseTransformDirection(normal,viewMatrix)','normalize(testNormal)')
    .replace('normalize(vBcSkyDirection-cameraPosition)','normalize(testIncident)')+'\nreturn outgoingLight;}';
const template=await readFile(new URL('../world-filament/src/main/materials/instanced.mat.in',import.meta.url),'utf8');
const ns=template.indexOf('float3 sourceReflection('),ne=template.indexOf('void material(',ns);assert.ok(ns>=0&&ne>ns);
const native=template.slice(ns,ne).replaceAll('float3','vec3').replaceAll('materialParams.skyGain','bcSkyReflectionGain')
  .replace('sourceReflection(', 'nativeReflection(')+`
  vec3 sourceReflection(float r,vec3 incident,vec3 normal){return nativeReflection(r,normalize(incident),normalize(normal));}`;
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage();
  const result=await page.evaluate(({field,source,native})=>{
    const gl=document.createElement('canvas').getContext('webgl2',{antialias:false});
    if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('Float WebGL2 unavailable');
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,32,32);
    const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete float target');
    const compile=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const v=compile(gl.VERTEX_SHADER,`#version 300 es\nvoid main(){gl_Position=vec4(float((gl_VertexID<<1)&2)*2.-1.,float(gl_VertexID&2)*2.-1.,0,1);}`);
    const programs=[source,native].map(block=>{
      const f=compile(gl.FRAGMENT_SHADER,`#version 300 es\nprecision highp float;\n${field}\nuniform float bcSkyReflectionGain,roughness;
        uniform vec3 testNormal;out vec4 color;\n${block}
        void main(){vec2 p=(gl_FragCoord.xy/32.-.5)*2.;vec3 incident=vec3(p.x,-.35,p.y);
          color=vec4(sourceReflection(roughness,incident,testNormal),1);}`);
      const p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return {p,f};
    });
    const profiles=[{name:'off',s:0,g:0,a:0,meteor:-1},{name:'galaxy',s:0,g:1,a:0,meteor:-1},
      {name:'stars',s:1,g:0,a:0,meteor:-1},{name:'aurora',s:0,g:0,a:1,meteor:-1},
      {name:'meteor',s:1,g:0,a:0,meteor:.5},{name:'all',s:1,g:1,a:1,meteor:.5}];
    gl.viewport(0,0,32,32);gl.bindVertexArray(gl.createVertexArray());
    let maxError=0,nonzero=0,zeroCases=0;const cases=[];
    for(const profile of profiles)for(const r of [0,.12,.34,.47,.6,1])for(const normal of [[0,1,0],[.3,.9,.1],[0,-1,0]]){
      const images=[];let maximum=0;
      for(const {p} of programs){
        gl.useProgram(p);
        for(const [name,value] of Object.entries({bcSkyStars:profile.s,bcSkyGalaxy:profile.g,bcSkyAurora:profile.a,
          bcSkyTime:13,bcSkyDensity:1.7,bcSkyMeteor:profile.meteor,bcSkyReflectionGain:1.2,roughness:r}))
          gl.uniform1f(gl.getUniformLocation(p,name),value);
        gl.uniform3fv(gl.getUniformLocation(p,'bcSkyColdDirection'),[0,0,-1]);
        gl.uniform3fv(gl.getUniformLocation(p,'bcSkyGalaxyNormal'),[.82,.22,-.52]);
        gl.uniform3fv(gl.getUniformLocation(p,'testNormal'),normal);
        gl.drawArrays(gl.TRIANGLES,0,3);const image=new Float32Array(32*32*4);gl.readPixels(0,0,32,32,gl.RGBA,gl.FLOAT,image);
        if(gl.getError()!==gl.NO_ERROR||![...image].every(Number.isFinite))throw Error('Invalid optical result');images.push(image);
      }
      for(let i=0;i<images[0].length;i++)if(i%4!==3){const err=Math.abs(images[0][i]-images[1][i]);maxError=Math.max(maxError,err);maximum=Math.max(maximum,images[0][i]);}
      if(profile.name==='off'||r>=.6){if(maximum!==0)throw Error('Inactive/rough surface reflected night field');zeroCases++;}
      if(maximum>0)nonzero++;
      cases.push({profile:profile.name,roughness:r,normal,maximum});
    }
    for(const {p,f} of programs){gl.deleteProgram(p);gl.deleteShader(f);}gl.deleteShader(v);gl.deleteFramebuffer(fb);gl.deleteTexture(texture);
    return {cases,maxAbsoluteError:maxError,nonzeroCases:nonzero,zeroCases};
  },{field,source,native});
  await writeFile(path.join(output,'numeric-result.json'),JSON.stringify(result,null,2));
  assert.ok(result.maxAbsoluteError<2e-5,JSON.stringify({maxAbsoluteError:result.maxAbsoluteError}));assert.ok(result.nonzeroCases>20);
  const report={passed:true,sourceFieldSha256:hash(field),sourceReflectionSha256:hash(source),nativeReflectionSha256:hash(native),result,
    scope:'Actual source and adapted reflection GLSL evaluated on the same WebGL2 float target; not native whole-scene parity or cross-driver hash equivalence.',p1GatePassed:false,p2Started:false};
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,cases:result.cases.length,maxAbsoluteError:result.maxAbsoluteError,nonzeroCases:result.nonzeroCases}));
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error)}));throw error;}
finally{await browser.close();}
