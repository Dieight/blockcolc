import * as THREE from 'three';
import type { SunState } from './lighting';
import type { WeatherState } from './environment';
import { weatherVisualForWeather } from './environment';

const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function blend(a:number,b:number,t:number){return new THREE.Color(a).lerp(new THREE.Color(b),t).getHex();}
export function solarAltitudeForSky(state:SunState):number {
  return state.sunAltitudeDeg ?? Math.asin(state.sunPosition[1]/Math.max(.001,Math.hypot(...state.sunPosition)))*180/Math.PI;
}
/** Solar altitude drives both the geographic and local-source palette. */
export function twilightPalette(state:SunState,variant=0):SunState {
  const altitude=solarAltitudeForSky(state);
  const warm=smooth(-7,-1,altitude)*(1-smooth(3,14,altitude));
  const blue=smooth(-12,-6,altitude)*(1-smooth(-2,1,altitude));
  const pink=variant>.5;
  return {...state,
    skyHorizonColor:blend(blend(state.skyHorizonColor,pink?0xf5a4bd:0xf68b64,warm*.74),0x638ac4,blue*.5),
    skyZenithColor:blend(blend(state.skyZenithColor,0x68538f,warm*.3),0x213f86,blue*.72),
    skyColor:blend(blend(state.skyColor,pink?0xca8bb4:0xe09573,warm*.45),0x3a5d9a,blue*.55),
    cloudColor:blend(state.cloudColor,pink?0xefb1c1:0xf1b18c,warm*.52),
    fogColor:blend(blend(state.fogColor,pink?0xc18da3:0xc78d79,warm*.28),0x49658c,blue*.3),
  };
}
export function nightSkyVisibility(state:SunState,weather:WeatherState,coldRegion:boolean){
  const dark=1-smooth(-17,-7,solarAltitudeForSky(state));
  const clear=weatherVisualForWeather(weather).starVisibilityScale;
  const moon=state.moonVisibility*Math.max(0,Math.min(1,state.moonIllumination??1));
  return {stars:dark*clear*(1-moon*.35),galaxy:dark*clear*(1-moon*.62),aurora:coldRegion?dark*clear*(1-moon*.3):0};
}

// One directional field is evaluated by the dome AND reflective surfaces.
// No screen-space stickers or a different random star map in the water.
export const NIGHT_SKY_GLSL = `
uniform float bcSkyStars, bcSkyGalaxy, bcSkyAurora, bcSkyTime, bcSkyDensity, bcSkyMeteor;
uniform vec3 bcSkyColdDirection;
float bcSkyHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float bcSkyHash3(vec3 p){return bcSkyHash(vec2(p.x+p.z*59.0,p.y+p.z*7.0));}
float bcSkyNoise3(vec3 p){
  vec3 a=floor(p),b=fract(p);b=b*b*b*(b*(b*6.0-15.0)+10.0);
  return mix(mix(mix(bcSkyHash3(a),bcSkyHash3(a+vec3(1,0,0)),b.x),
                 mix(bcSkyHash3(a+vec3(0,1,0)),bcSkyHash3(a+vec3(1,1,0)),b.x),b.y),
             mix(mix(bcSkyHash3(a+vec3(0,0,1)),bcSkyHash3(a+vec3(1,0,1)),b.x),
                 mix(bcSkyHash3(a+vec3(0,1,1)),bcSkyHash3(a+vec3(1,1,1)),b.x),b.y),b.z);
}
float bcSkyCloud(vec3 p){return bcSkyNoise3(p)*.55+bcSkyNoise3(p*2.07+vec3(11.3,7.1,3.7))*.3+bcSkyNoise3(p*4.13+vec3(2.9,17.4,6.3))*.15;}
vec3 bcNightSky(vec3 direction){
  vec3 d=normalize(direction);float horizon=smoothstep(0.015,0.13,d.y);
  if(horizon<0.001 || bcSkyStars+bcSkyGalaxy+bcSkyAurora<0.001)return vec3(0);
  vec2 uv=vec2(atan(d.z,d.x)/6.2831853+0.5,asin(clamp(d.y,-1.0,1.0))/3.1415926+0.5);
  vec2 cell=floor(uv*vec2(320,160)),within=fract(uv*vec2(320,160));
  cell.x=mod(cell.x,320.0);
  float seed=bcSkyHash(cell),star=step(1.0-0.014*bcSkyDensity,seed);
  float size=mix(0.1,0.24,bcSkyHash(cell+4.7));
  // Keep subpixel stars sampled in a distant water/ice reflection, without
  // turning every star into a screen-space sprite or a large bright disc.
  vec2 dx=dFdx(uv),dy=dFdy(uv);dx.x=sign(dx.x)*min(abs(dx.x),1.0-abs(dx.x));dy.x=sign(dy.x)*min(abs(dy.x),1.0-abs(dy.x));
  float pixel=max(length(dx*vec2(320,160)),length(dy*vec2(320,160)));
  float edge=max(0.045,min(.2,pixel*.65));
  float dotStar=1.0-smoothstep(size,size+edge,length(within-vec2(0.5)));
  float twinkle=0.92+0.08*sin(bcSkyTime*1.3+seed*121.0);
  vec3 stars=mix(vec3(0.65,0.79,1.0),vec3(1.0,0.86,0.67),bcSkyHash(cell+8.0))*dotStar*star*bcSkyStars*twinkle*1.5;
  float band=abs(dot(d,normalize(vec3(0.82,0.22,-0.52))));
  // Sample the sphere itself, not a longitude texture. There is no atlas seam
  // at atan's +/-PI or at the poles, even when reflected across many water cells.
  float dust=bcSkyCloud(d*7.0+vec3(4.3,1.7,8.9)),fine=bcSkyNoise3(d*53.0+vec3(21,7,14));
  float core=exp(-band*band*mix(85.0,150.0,dust));
  float halo=exp(-band*band*28.0)*.09;
  float rift=.3+.7*smoothstep(.25,.64,bcSkyNoise3(d*13.0+vec3(3,11,19)));
  float galaxy=core*(.13+.7*dust+.17*fine)*rift+halo;
  vec3 milk=mix(vec3(.12,.18,.33),vec3(.48,.34,.46),smoothstep(.35,.7,dust))*galaxy*bcSkyGalaxy;
  float facing=pow(max(0.0,dot(normalize(vec3(d.x,0,d.z)),bcSkyColdDirection)),5.0);
  float angle=atan(d.z,d.x);
  float wave=0.25+0.07*sin(angle*7.0+bcSkyTime*0.18)+0.03*sin(angle*15.0-bcSkyTime*0.12);
  float curtain=exp(-pow((d.y-wave)*9.0,2.0))*facing;
  float rays=pow(0.5+0.5*sin(angle*64.0+bcSkyTime*.3+sin(angle*3.0)*12.0),2.0);
  vec3 aurora=mix(vec3(0.06,0.32,0.2),vec3(0.23,0.09,0.32),smoothstep(wave,wave+.2,d.y))*curtain*(.35+.65*rays)*bcSkyAurora;
  vec2 head=vec2(.1,.8)+vec2(.07,-.12)*bcSkyMeteor,tail=vec2(.07,-.12);
  vec2 p=uv-head;float along=clamp(dot(p,tail)/dot(tail,tail),-.24,0.0);
  float line=1.0-smoothstep(.0008,.0025,length(p-tail*along));
  float meteor=line*exp(along*12.0)*sin(clamp(bcSkyMeteor,0.0,1.0)*3.1415926)*bcSkyStars*step(0.0,bcSkyMeteor);
  return (stars+milk+aurora+vec3(.7,.86,1.0)*meteor*2.0)*horizon;
}`;

export class SkySpectacle {
  readonly uniforms={bcSkyStars:{value:0},bcSkyGalaxy:{value:0},bcSkyAurora:{value:0},bcSkyTime:{value:0},bcSkyDensity:{value:1},bcSkyMeteor:{value:-1},bcSkyColdDirection:{value:new THREE.Vector3(0,0,-1)}};
  private elapsed=0; private last:number|null=null; private reduced=false;
  private patched=new WeakSet<THREE.Material>();
  update(state:SunState,weather:WeatherState,coldRegion:boolean,reducedMotion:boolean,density:number){
    const v=nightSkyVisibility(state,weather,coldRegion);this.uniforms.bcSkyStars.value=v.stars;this.uniforms.bcSkyGalaxy.value=v.galaxy;this.uniforms.bcSkyAurora.value=v.aurora;this.uniforms.bcSkyDensity.value=density;this.reduced=reducedMotion;
  }
  tick(now:number,visible:boolean){
    const active=visible&&!this.reduced&&this.uniforms.bcSkyStars.value>.01;
    if(active&&this.last!==null)this.elapsed+=Math.max(0,Math.min(2,(now-this.last)/1000));
    this.last=active?now:null;this.uniforms.bcSkyTime.value=this.elapsed;
    const slot=this.elapsed%48;this.uniforms.bcSkyMeteor.value=active&&slot>=12&&slot<13.6?(slot-12)/1.6:-1;
    return active;
  }
  patchSky(material:THREE.Material){this.patch(material,true);}
  patchReflection(material:THREE.MeshStandardMaterial,gain=1){this.patch(material,false,gain);}
  private patch(material:THREE.Material,sky:boolean,gain=1){
    if(this.patched.has(material))return;this.patched.add(material);
    const before=material.onBeforeCompile,key=material.customProgramCacheKey();
    material.onBeforeCompile=(shader,renderer)=>{
      before.call(material,shader,renderer);Object.assign(shader.uniforms,this.uniforms);
      if(!sky)shader.uniforms.bcSkyReflectionGain={value:gain};
      const declaration=`varying vec3 vBcSkyDirection;`;
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${declaration}`)
        .replace('#include <project_vertex>', sky?'#include <project_vertex>\nvBcSkyDirection = position;':`#include <project_vertex>
vec4 bcWorldPos=vec4(transformed,1.0);
#ifdef USE_BATCHING
bcWorldPos=batchingMatrix*bcWorldPos;
#endif
#ifdef USE_INSTANCING
bcWorldPos=instanceMatrix*bcWorldPos;
#endif
vBcSkyDirection=(modelMatrix*bcWorldPos).xyz;`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${declaration}\n${sky?'':'uniform float bcSkyReflectionGain;'}\n${NIGHT_SKY_GLSL}`)
        .replace('#include <opaque_fragment>',sky?`outgoingLight += bcNightSky(vBcSkyDirection);\n#include <opaque_fragment>`:`
float bcReflective=(1.0-smoothstep(.34,.6,roughnessFactor));
if(bcReflective>0.001){
vec3 bcWorldNormal=inverseTransformDirection(normal,viewMatrix);
vec3 bcIncident=normalize(vBcSkyDirection-cameraPosition);
vec3 bcReflected=reflect(bcIncident,bcWorldNormal);
float bcFresnel=.18+.82*pow(1.0-abs(dot(-bcIncident,bcWorldNormal)),3.0);
outgoingLight += bcNightSky(bcReflected)*bcReflective*bcFresnel*1.8*bcSkyReflectionGain;
}
#include <opaque_fragment>`);
    };material.customProgramCacheKey=()=>`${key}|bc-night-field-v4:${sky}`;material.needsUpdate=true;
  }
}
