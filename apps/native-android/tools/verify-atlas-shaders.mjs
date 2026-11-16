import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import * as THREE from 'three';
import {atlasDefinition,bakeAtlasVertex} from './atlas-source.mjs';

// Run the captured, identity-checked production vertex patch, not a second JS
// reimplementation. Compare it to the actual native material vertex function
// after static preparation. Device BRDF / filtering parity is a separate check.
const [output,input]=process.argv.slice(2);if(!output||!input)throw Error('new-output and complete MC frozen-input directory required');
await mkdir(output,{recursive:false});
const examples=JSON.parse(await readFile(new URL('./fixtures/reviewed-atlas-programs.json',import.meta.url))).programs;
const metadata=JSON.parse(await readFile(input+'/ocean.world.json'));
const hash=s=>createHash('sha256').update(s).digest('hex');
for(const e of examples){const p=metadata.programs.find(p=>p.cacheKey===e.definition.cacheKey);
  assert.ok(p,'Captured program is absent from actual controlled source');assert.equal(p.vertex,e.definition.vertex);assert.equal(p.fragment,e.definition.fragment);}
const template=await readFile(new URL('../world-filament/src/main/materials/instanced.mat.in',import.meta.url),'utf8');
const vertex=template.match(/\nvertex \{([\s\S]*?)\n\}\nfragment \{/)?.[1];if(!vertex)throw Error('Material vertex boundary changed');
const native=vertex.replace('@SOURCE_NORMAL@','material.sourceNormal=getCustom0();').replace('@NORMAL@','');
const normals=[[0,-1,0],[0,1,0],[0,0,-1],[0,0,1],[-1,0,0],[1,0,0]];
const groups=[];
for(const index of [0,3,6]){
  const e=examples[index],material=new THREE.MeshStandardMaterial({map:new THREE.Texture()}),uniforms={};
  for(const [name,v] of Object.entries(e.uniforms))uniforms[name]={value:Array.isArray(v)?v.length===2?new THREE.Vector2(...v):new THREE.Vector3(...v):v};
  const d=atlasDefinition(material,{...e.definition,uniforms});
  const cases=[];
  function add(slot,rotation,kind,occ,flow=0,uv=[.19,.83],crop=0){
    const starts=[[0,0],[.2,.3],[.8,.9]],ends=[[1,1],[.7,.9],[.1,.2]],start=starts[crop],end=ends[crop];
    const pack=(p,r=0)=>Math.round(p[0]*2047)+Math.round(p[1]*2047)*2048+r*4194304;
    const appearance={tiles:[17,39,62,83,104,125],uvA:Array(6).fill(pack(start,rotation)),uvB:Array(6).fill(pack(end)),tint:kind*16**slot,flow};
    const position=[slot%2?-.5:.5,.5,slot%3?-.5:.5],occlusion=flow||occ;
    const c={slot,rotation,kind,occlusion,flow,crop,uv,position,normal:normals[slot],occlusionSlot:d.shape?(slot+1)%6:slot,shade:.73,response:flow?1234567:slot%5,appearance};
    c.prepared=bakeAtlasVertex({uv,position,normal:c.normal,slot,occlusionSlot:c.occlusionSlot,shade:c.shade},appearance,d);
    cases.push(c);
  }
  for(let slot=0;slot<6;slot++)for(let r=0;r<4;r++)for(let kind=0;kind<12;kind++)add(slot,r,kind,(slot*733+r*91)%4096,0,[r%2?.99:.01,.27],r%3);
  if(!d.shape)for(let slot=0;slot<6;slot++)for(const angle of [0,256,1024,2048,4095])for(let r=0;r<4;r++)
    add(slot,r,3,0,1000000+65536+32768+angle,[.2,.8],r%3);
  else for(let slot=0;slot<6;slot++)for(const uv of [[0,0],[1,1],[.5,.5]])add(slot,0,8,4095,0,uv);
  const s=e.definition.vertex;
  const declarations=s.slice(s.indexOf('#include <common>')+18,s.indexOf('#include <batching_pars_vertex>'))
    .replaceAll('attribute ','uniform ').replaceAll('varying ','out ');
  const body=s.slice(s.indexOf('#include <uv_vertex>')+20,s.indexOf('#include <color_vertex>'));
  const position=s.slice(s.indexOf('#include <begin_vertex>')+23,s.indexOf('#include <morphtarget_vertex>'));
  groups.push({key:e.definition.cacheKey,d,uniforms:e.uniforms,cases,declarations,body,position});
}
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage();
  const report=await page.evaluate(({groups,native})=>{
    const gl=document.createElement('canvas').getContext('webgl2');if(!gl)throw Error('WebGL2 unavailable');
    const prologue=`#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
#define float2 vec2
#define float3 vec3
#define float4 vec4
#define texture2D texture
uniform vec4 localPosition;uniform vec3 localNormal;uniform vec2 inputUv;uniform vec4 inputColor;
out vec4 resultUv;out vec4 resultColor;out vec4 resultPosition;
`;
    function compile(vertex){const shader=(type,text)=>{const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
      const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,prologue+vertex));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(0);}'));
      gl.transformFeedbackVaryings(p,['resultUv','resultColor','resultPosition'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
    const nativeProgram=compile(`
struct Parameters {int motionKind;mat4 motionData;bool fluidSurface;int billboardMode;float pointSize;vec2 viewportSize;vec2 billboardCenter;bool vertexColors;vec3 uvRowU;vec3 uvRowV;bool flipV;};
uniform Parameters materialParams;
uniform sampler2D materialParams_instanceData,materialParams_runtimeData,materialParams_weatherGround,materialParams_atlasLookup,materialParams_atlasBlend;
struct MaterialVertexInputs {vec4 sourcePosition;vec4 sourceNormal;vec4 sourceAtlas;vec4 worldPosition;vec4 color;vec2 uv0;};
vec4 getPosition(){return localPosition;}vec4 getCustom0(){return vec4(localNormal,0);}uint getInstanceIndex(){return 0u;}
mat4 getWorldFromModelMatrix(){return mat4(1);}mat3 getWorldFromModelNormalMatrix(){return mat3(1);}mat4 getViewFromWorldMatrix(){return mat4(1);}mat4 getClipFromViewMatrix(){return mat4(1);}
${native}
void main(){MaterialVertexInputs m;m.uv0=inputUv;m.color=inputColor;materialVertex(m);resultUv=vec4(m.uv0,m.sourceAtlas.xy);resultColor=vec4(m.color.rgb,m.sourceAtlas.z);resultPosition=vec4(m.worldPosition.xyz,m.sourceAtlas.w);gl_Position=vec4(0,0,0,1);}`);
    const feedback=gl.createBuffer();gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,feedback);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,48,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,feedback);
    gl.bindVertexArray(gl.createVertexArray());gl.enable(gl.RASTERIZER_DISCARD);
    function set(p,name,v){const u=gl.getUniformLocation(p,name);if(u===null)return;if(typeof v==='number')gl.uniform1f(u,v);else if(v.length===16)gl.uniformMatrix4fv(u,false,v);else if(v.length===4)gl.uniform4fv(u,v);else if(v.length===3)gl.uniform3fv(u,v);else gl.uniform2fv(u,v);}
    function integer(p,name,n){const u=gl.getUniformLocation(p,name);if(u!==null)gl.uniform1i(u,n);}
    function texture(unit,width,height,format,type,data){const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,format,width,height,0,gl.RGBA,type,data);return t;}
    const rows=new Float32Array(24);rows.set([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,1,1,1,1]);
    const rowTexture=texture(0,6,1,gl.RGBA32F,gl.FLOAT,rows);
    const results=[];let maximumUvDelta=0,maximumColorDelta=0,maximumPositionDelta=0,worst=null;
    function run(p){gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();const result=new Float32Array(12);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,result);return [...result];}
    for(const g of groups){
      const [width,height]=g.uniforms.blockcolcAnimationLookupSize,frames=new Uint8Array(width*height*4),blends=new Uint8Array(width*height*4);
      for(let i=0;i<width*height;i++){const a=(i+7)%1600,b=(i+11)%1600;frames.set([a&255,a>>8,b&255,b>>8],i*4);blends.set([i%256,0,0,255],i*4);}
      const a=texture(1,width,height,gl.RGBA8,gl.UNSIGNED_BYTE,frames),b=texture(2,width,height,gl.RGBA8,gl.UNSIGNED_BYTE,blends);
      const source=compile(g.declarations+`
uniform vec3 normal,position;vec2 vMapUv;
void main(){vMapUv=inputUv;${g.body}\nvec3 transformed=position;${g.position}\nresultUv=vec4(vMapUv,vBlockcolcNextMapUv);resultColor=vec4(vBlockcolcTint*vBlockcolcDirectionalShade*(1.-vBlockcolcLocalOcclusion*.28),vBlockcolcAnimationMix);resultPosition=vec4(transformed,vBlockcolcMaterialResponse);gl_Position=vec4(0,0,0,1);}`);
      gl.useProgram(source);for(const [name,value] of Object.entries(g.uniforms))if(typeof value==='number'||Array.isArray(value))set(source,name,value);
      integer(source,'blockcolcAnimationLookup',1);integer(source,'blockcolcAnimationBlendLookup',2);
      gl.useProgram(nativeProgram);integer(nativeProgram,'materialParams.motionKind',6);integer(nativeProgram,'materialParams.fluidSurface',g.d.shape?0:1);
      integer(nativeProgram,'materialParams_instanceData',0);integer(nativeProgram,'materialParams_runtimeData',0);integer(nativeProgram,'materialParams_weatherGround',0);integer(nativeProgram,'materialParams_atlasLookup',1);integer(nativeProgram,'materialParams_atlasBlend',2);
      set(nativeProgram,'materialParams.motionData',[...g.d.size,g.d.columns,g.d.cell,width,height,0,0,0,0,0,0,0,0,0,0]);set(nativeProgram,'materialParams.uvRowU',[1,0,0]);set(nativeProgram,'materialParams.uvRowV',[0,1,0]);
      let worstGroup=0;
      for(const c of g.cases){
        gl.useProgram(source);set(source,'inputUv',c.uv);set(source,'position',c.position);set(source,'normal',c.normal);
        set(source,'instanceFaceTilesA',c.appearance.tiles.slice(0,3));set(source,'instanceFaceTilesB',c.appearance.tiles.slice(3));
        for(const prefix of ['A','B'])for(let group=0;group<2;group++)set(source,'instanceFaceUvWord'+prefix+group,c.appearance['uv'+prefix].slice(group*3,group*3+3));
        for(const [name,value]of Object.entries({instanceFaceTintKinds:c.appearance.tint,instanceFaceOcclusion:c.occlusion,instanceMaterialResponse:c.response,faceSlot:c.slot,faceOcclusionSlot:c.occlusionSlot,faceShadeFactor:c.shade}))set(source,name,value);
        const expected=run(source);
        rows[20]=c.occlusion;rows[21]=c.response;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,rowTexture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,6,1,gl.RGBA,gl.FLOAT,rows);
        gl.useProgram(nativeProgram);set(nativeProgram,'inputUv',c.prepared.uv);set(nativeProgram,'inputColor',c.prepared.color);set(nativeProgram,'localPosition',[...c.position,1]);set(nativeProgram,'localNormal',c.normal);
        const actual=run(nativeProgram),deltas=actual.map((v,i)=>Math.abs(v-expected[i]));if([...actual,...expected].some(n=>!Number.isFinite(n)))throw Error('Nonfinite atlas shader result');
        const du=Math.max(...deltas.slice(0,4)),dc=Math.max(...deltas.slice(4,8)),dp=Math.max(...deltas.slice(8));
        maximumUvDelta=Math.max(maximumUvDelta,du);maximumColorDelta=Math.max(maximumColorDelta,dc);maximumPositionDelta=Math.max(maximumPositionDelta,dp);
        if(Math.max(...deltas)>worstGroup){worstGroup=Math.max(...deltas);worst={key:g.key,case:c,expected,actual};}
      }
      results.push({key:g.key,cases:g.cases.length,maximumDelta:worstGroup});gl.deleteProgram(source);gl.deleteTexture(a);gl.deleteTexture(b);
    }
    const error=gl.getError();if(error!==gl.NO_ERROR)throw Error('Atlas GL error '+error);
    return {groups:results,maximumUvDelta,maximumColorDelta,maximumPositionDelta,worst};
  },{groups,native});
  const passed=report.maximumUvDelta<=.000002&&report.maximumColorDelta<=.000002&&report.maximumPositionDelta<=.000002;
  await writeFile(output+'/report.json',JSON.stringify({...report,completed:true,passed,sourcePrograms:examples.map(e=>({key:e.definition.cacheKey,vertexSha256:hash(e.definition.vertex)})),nativeSha256:hash(native),
    tolerance:2e-6,scope:'Highp WebGL2 transform feedback of actual source patch versus prepared native material; not device BRDF/filtering or P1 completion'},null,2));
  assert.ok(passed,'Atlas vertex adaptation differs; inspect retained report');
  console.log(JSON.stringify({passed,cases:report.groups.reduce((n,g)=>n+g.cases,0),maximumUvDelta:report.maximumUvDelta,maximumColorDelta:report.maximumColorDelta,maximumPositionDelta:report.maximumPositionDelta}));
}catch(error){await writeFile(output+'/failure.json',JSON.stringify({error:String(error)},null,2));throw error;}
finally{await browser.close();}
