import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {weatherPrograms} from './weather-oracle.mjs';
const output=process.argv[2];if(!output)throw Error('New evidence directory required');await mkdir(output,{recursive:false});
const template=await readFile(new URL('../world-filament/src/main/materials/instanced.mat.in',import.meta.url),'utf8');
const vertex=template.match(/\nvertex \{([\s\S]*?)\n\}\nfragment \{/)?.[1];if(!vertex)throw Error('Material vertex boundary changed');
const native=vertex.replace('@SOURCE_NORMAL@','material.sourceNormal=getCustom0();').replace('@NORMAL@','');
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage();
  const report=await page.evaluate(({programs,native})=>{
    const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');if(!gl)throw Error('WebGL2 required');
    const prologue=`#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
#define float2 vec2
#define float3 vec3
#define float4 vec4
#define texture2D texture
uniform vec4 localPosition; uniform mat4 origin; out vec4 resultPosition;`;
    function compile(vertex){
      const shader=(type,text)=>{const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
      const p=gl.createProgram(),v=shader(gl.VERTEX_SHADER,prologue+vertex),f=shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(0.0);}');
      gl.attachShader(p,v);gl.attachShader(p,f);gl.transformFeedbackVaryings(p,['resultPosition'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.deleteShader(v);gl.deleteShader(f);return p;
    }
    const nativeProgram=compile(`
struct Parameters {int motionKind;mat4 motionData;bool fluidSurface;int billboardMode;float pointSize;vec2 viewportSize;vec2 billboardCenter;bool vertexColors;vec3 uvRowU;vec3 uvRowV;bool flipV;};
uniform Parameters materialParams;
uniform sampler2D materialParams_instanceData;uniform sampler2D materialParams_runtimeData;uniform sampler2D materialParams_weatherGround;
struct MaterialVertexInputs {vec4 sourcePosition;vec4 sourceNormal;vec4 worldPosition;vec4 color;vec2 uv0;};
vec4 getPosition(){return localPosition;}vec4 getCustom0(){return vec4(0.0,1.0,0.0,0.0);}uint getInstanceIndex(){return 0u;}
mat4 getWorldFromModelMatrix(){return origin;}mat3 getWorldFromModelNormalMatrix(){return mat3(1.0);}mat4 getViewFromWorldMatrix(){return mat4(1.0);}mat4 getClipFromViewMatrix(){return mat4(1.0);}
${native}
void main(){MaterialVertexInputs m;m.uv0=vec2(0.0);m.color=vec4(1.0);materialVertex(m);resultPosition=m.worldPosition;gl_Position=vec4(0.0,0.0,0.0,1.0);}`);
    const feedback=gl.createBuffer();gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,feedback);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,16,gl.STREAM_READ);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,feedback);gl.enable(gl.RASTERIZER_DISCARD);
    const matrix=(x,y,z)=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1]);
    const rows=new Float32Array(24),ground=new Float32Array([-2.5,.125,40,3.75]);
    const textures=[];
    function texture(unit,width,height,format,data){const t=gl.createTexture();textures.push(t);gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,format,width,height,0,format===gl.R32F?gl.RED:gl.RGBA,gl.FLOAT,data);return t;}
    const rowTexture=texture(0,6,1,gl.RGBA32F,rows),clock=texture(1,1,1,gl.RGBA32F,new Float32Array(4));texture(2,2,2,gl.R32F,ground);
    function one(p,name,value){const u=gl.getUniformLocation(p,name);if(u===null)return;
      if(typeof value==='number')gl.uniform1f(u,value);else if(value.length===16)gl.uniformMatrix4fv(u,false,value);
      else if(value.length===4)gl.uniform4fv(u,value);else if(value.length===3)gl.uniform3fv(u,value);else gl.uniform2fv(u,value);}
    function integer(p,name,n){const u=gl.getUniformLocation(p,name);if(u!==null)gl.uniform1i(u,n);}
    function run(p){gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();const out=new Float32Array(4);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,out);return [...out];}
    const cases=[];let maximumAbsoluteDelta=0;
    for(const {snow,definition} of programs){
      const scale=definition.vertex.split('#include <begin_vertex>')[1].split('#include <morphtarget_vertex>')[0];
      const project=definition.vertex.match(/vec4 mvPosition = vec4\(transformed, 1\.0\);[\s\S]*?gl_Position = projectionMatrix \* mvPosition;/)?.[0];
      if(!project)throw Error('Source precipitation patch changed');
      const source=compile(`
#define USE_INSTANCING
uniform mat4 instanceMatrix;uniform float weatherSize,weatherPhase,weatherElapsed,weatherBase,weatherSpan,weatherSpeed;
uniform vec2 weatherCenter,weatherOffset,weatherField;uniform vec4 weatherGroundBounds;uniform sampler2D weatherGround;
void main(){vec3 transformed=localPosition.xyz;mat4 modelViewMatrix=origin;mat4 projectionMatrix=mat4(1.0);${scale}\n${project}\nresultPosition=mvPosition;}`);
      for(const phase of [0,.25,.9])for(const elapsed of [0,16,777,123456])for(const local of [[-.03,-.6,.02,1],[.03,.6,-.02,1]])for(const far of [false,true])for(const shifted of [false,true]){
        const transform=matrix(0,-2+phase*40,0),world=matrix(shifted?-300:0,shifted?-50:0,shifted?400:0);
        const center=far?[100,-40]:[0,0],field=far?[900,400]:[80,80],offset=[-.23,.37],size=snow?2:2.3,speed=1.1;
        rows.set(transform,0);rows.set([1,1,1,1,phase,...offset,0],16);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,rowTexture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,6,1,gl.RGBA,gl.FLOAT,rows);
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,clock);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1,1,gl.RGBA,gl.FLOAT,new Float32Array([0,-2,0,elapsed]));
        gl.useProgram(source);one(source,'localPosition',local);one(source,'origin',world);one(source,'instanceMatrix',transform);
        for(const [name,v] of Object.entries({weatherSize:size,weatherPhase:phase,weatherElapsed:elapsed,weatherBase:.2,weatherSpan:40,weatherSpeed:speed,weatherCenter:center,weatherOffset:offset,weatherField:field,weatherGroundBounds:[-500,-400,1000,800]}))one(source,name,v);
        integer(source,'weatherGround',2);const expected=run(source);
        gl.useProgram(nativeProgram);one(nativeProgram,'localPosition',local);one(nativeProgram,'origin',world);
        integer(nativeProgram,'materialParams.motionKind',snow?3:2);integer(nativeProgram,'materialParams_instanceData',0);integer(nativeProgram,'materialParams_runtimeData',1);integer(nativeProgram,'materialParams_weatherGround',2);
        one(nativeProgram,'materialParams.motionData',new Float32Array([0,.2,40,speed,size,...center,0,...field,-500,-400,1000,800,1,0]));
        one(nativeProgram,'materialParams.uvRowU',[1,0,0]);one(nativeProgram,'materialParams.uvRowV',[0,1,0]);
        const actual=run(nativeProgram),delta=Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])));maximumAbsoluteDelta=Math.max(maximumAbsoluteDelta,delta);
        cases.push({snow,phase,elapsed,far,shifted,local,expected,actual,delta});
      }
      gl.deleteProgram(source);
    }
    const error=gl.getError();for(const t of textures)gl.deleteTexture(t);gl.deleteBuffer(feedback);gl.deleteProgram(nativeProgram);
    if(error!==gl.NO_ERROR)throw Error('Transform-feedback GL error '+error);
    return {kind:'actual-source-and-adapted-vertex-transform-feedback',cases,maximumAbsoluteDelta,
      scope:'Real highp WebGL2 shader equations, not Filament whole-scene or cross-driver visual parity'};
  },{programs:weatherPrograms(),native});
  await writeFile(output+'/report.json',JSON.stringify(report,null,2));
  if(report.maximumAbsoluteDelta>.001)throw Error('Weather vertex transform differs: '+report.maximumAbsoluteDelta);
  console.log(JSON.stringify({cases:report.cases.length,maximumAbsoluteDelta:report.maximumAbsoluteDelta}));
}finally{await browser.close();}
