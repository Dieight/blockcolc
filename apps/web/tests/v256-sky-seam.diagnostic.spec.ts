import {expect,test} from '@playwright/test';
import {NIGHT_SKY_GLSL} from '../../../packages/voxel/src/sky-spectacle';

test('the actual GPU galaxy field is continuous across the longitude seam, including a water-reflected direction',async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(source=>{
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=96;
    const gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true})!;
    if(!gl)throw new Error('WebGL2 is required for the rendered seam check');
    const shader=(type:number,text:string)=>{
      const s=gl.createShader(type)!;gl.shaderSource(s,text);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)??'shader failed');return s;
    };
    const vertex=shader(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}');
    const fragment=shader(gl.FRAGMENT_SHADER,`#version 300 es
precision highp float;
${source}
out vec4 pixel;
void main(){
  float longitude=3.14159265359+(gl_FragCoord.x-128.0)*0.000001;
  float latitude=mix(1.1,1.5,gl_FragCoord.y/96.0);
  vec3 reflected=vec3(cos(latitude)*cos(longitude),sin(latitude),cos(latitude)*sin(longitude));
  vec3 incident=reflect(reflected,vec3(0,1,0));
  pixel=vec4(bcNightSky(reflect(incident,vec3(0,1,0))),1);
}`);
    const program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)??'link failed');
    gl.useProgram(program);gl.uniform1f(gl.getUniformLocation(program,'bcSkyGalaxy'),1);
    gl.uniform1f(gl.getUniformLocation(program,'bcSkyStars'),0);gl.uniform1f(gl.getUniformLocation(program,'bcSkyAurora'),0);
    gl.uniform1f(gl.getUniformLocation(program,'bcSkyMeteor'),-1);gl.uniform3f(gl.getUniformLocation(program,'bcSkyColdDirection'),0,0,-1);
    gl.viewport(0,0,256,96);gl.drawArrays(gl.TRIANGLES,0,3);
    const bytes=new Uint8Array(256*96*4);gl.readPixels(0,0,256,96,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    let seamJump=0,maximum=0;
    for(let y=0;y<96;y++)for(let channel=0;channel<3;channel++){
      const left=(y*256+127)*4+channel,right=left+4;
      seamJump=Math.max(seamJump,Math.abs(bytes[left]!-bytes[right]!));
    }
    for(let index=0;index<bytes.length;index++)if(index%4!==3)maximum=Math.max(maximum,bytes[index]!);
    const rendered=canvas.toDataURL();
    gl.uniform1f(gl.getUniformLocation(program,'bcSkyGalaxy'),0);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,256,96,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    const offMaximum=bytes.reduce((max,value,index)=>index%4!==3?Math.max(max,value):max,0);
    gl.deleteProgram(program);gl.deleteShader(fragment);gl.deleteShader(vertex);
    return{seamJump,maximum,offMaximum,rendered};
  },NIGHT_SKY_GLSL);
  expect(result.maximum).toBeGreaterThan(12);expect(result.offMaximum).toBe(0);
  expect(result.seamJump).toBeLessThanOrEqual(1);
  await info.attach('compiled-reflected-longitude-seam',{body:Buffer.from(result.rendered.split(',')[1]!,'base64'),contentType:'image/png'});
  await info.attach('seam-pixel-measurement',{body:JSON.stringify({...result,rendered:undefined}),contentType:'application/json'});
});
