import * as THREE from 'three';
import {LightingPostProcessor} from '../../../packages/voxel/src/lighting-postprocess';
import {WorldColorCompositor} from '../../../packages/voxel/src/world-color-compositor';

// An actual source renderer oracle. No native colour operator is imported.
const width=540,height=720,fov=40,eye=100;
const warm=[.8,.6,.4],blue=[.2,.4,.7];
const tiles=[
  {name:'mapped-opaque',color:warm,toneMapped:true,alpha:1,transparent:false,fog:false,depth:100,cutoff:0},
  {name:'unmapped-opaque',color:warm,toneMapped:false,alpha:1,transparent:false,fog:false,depth:100,cutoff:0},
  {name:'mapped-alpha',color:warm,toneMapped:true,alpha:.25,transparent:true,fog:false,depth:100,cutoff:0},
  {name:'unmapped-alpha',color:warm,toneMapped:false,alpha:.65,transparent:true,fog:false,depth:100,cutoff:0},
  {name:'mapped-half-fog',color:warm,toneMapped:true,alpha:1,transparent:false,fog:true,depth:100,cutoff:0},
  {name:'unmapped-half-fog',color:warm,toneMapped:false,alpha:1,transparent:false,fog:true,depth:100,cutoff:0},
  {name:'mapped-full-fog',color:warm,toneMapped:true,alpha:1,transparent:false,fog:true,depth:200,cutoff:0},
  {name:'mapped-alpha-half-fog',color:warm,toneMapped:true,alpha:.5,transparent:true,fog:true,depth:100,cutoff:0},
  {name:'cutout-discard',color:warm,toneMapped:true,alpha:.4,transparent:false,fog:false,depth:100,cutoff:.5},
  {name:'cutout-survive',color:warm,toneMapped:true,alpha:.6,transparent:false,fog:true,depth:100,cutoff:.5},
  {name:'blue-alpha-full-fog',color:blue,toneMapped:true,alpha:.65,transparent:true,fog:true,depth:200,cutoff:0},
  {name:'blue-unmapped-alpha-half-fog',color:blue,toneMapped:false,alpha:.25,transparent:true,fog:true,depth:100,cutoff:0},
].map((tile,index)=>({...tile,x:(index%4+.5)/4,y:(Math.floor(index/4)+.5)/3}));
const color=(rgb:number[])=>new THREE.Color().setRGB(rgb[0]!,rgb[1]!,rgb[2]!,THREE.LinearSRGBColorSpace);
const clear=[.09,.03,.18],background=[.07,.14,.2],fogColor=[.15,.25,.6];
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.setSize(width,height);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.append(renderer.domElement);
const post=new LightingPostProcessor(renderer),grade=new WorldColorCompositor(renderer);
const scene=new THREE.Scene();scene.background=color(clear);scene.fog=new THREE.Fog(color(fogColor),0,200);
const camera=new THREE.PerspectiveCamera(fov,width/height,.1,1000);camera.position.z=eye;camera.lookAt(0,0,0);
function plane(rgb:number[],depth:number,x:number,y:number,sx:number,sy:number,props:Partial<THREE.MeshBasicMaterialParameters>){
  const halfH=Math.tan(fov*Math.PI/360)*depth,halfW=halfH*width/height;
  const material=new THREE.MeshBasicMaterial({color:color(rgb),...props});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material);
  mesh.position.set((x*2-1)*halfW,(1-y*2)*halfH,eye-depth);mesh.scale.set(sx*halfW,sy*halfH,1);scene.add(mesh);
}
plane(background,220,.5,.5,1.92,1.92,{fog:false,toneMapped:true});
for(const tile of tiles)plane(tile.color,tile.depth,tile.x,tile.y,.4,.5,{fog:tile.fog,toneMapped:tile.toneMapped,
  opacity:tile.alpha,transparent:tile.transparent,depthWrite:!tile.transparent,alphaTest:tile.cutoff});
const configurations=[
  {name:'direct-dark',high:false,exposure:.7,grade:{saturation:100,brightness:100,contrast:100}},
  {name:'direct-bright',high:false,exposure:1.4,grade:{saturation:100,brightness:100,contrast:100}},
  {name:'bloom-dark',high:true,exposure:.7,grade:{saturation:100,brightness:100,contrast:100}},
  {name:'bloom-bright',high:true,exposure:1.4,grade:{saturation:100,brightness:100,contrast:100}},
  {name:'direct-graded',high:false,exposure:1.4,grade:{saturation:50,brightness:110,contrast:120}},
  {name:'bloom-graded',high:true,exposure:1.4,grade:{saturation:50,brightness:110,contrast:120}},
];
const gl=renderer.getContext();
const samples=[...tiles.map(t=>({name:t.name,x:t.x,y:t.y})),{name:'clear-border',x:.01,y:.01}];
(window as any).renderOracle=(index:number)=>{
  const config=configurations[index];if(!config)throw Error('Unknown source case');
  renderer.toneMappingExposure=config.exposure;post.configure(config.high,.32,width,height,1);
  grade.setPreference(config.grade);post.render(scene,camera);grade.render();gl.finish();
  const pixels=samples.map(sample=>{const x=Math.floor(sample.x*width),y=Math.floor(sample.y*height),rgba=new Uint8Array(4);
    gl.readPixels(x,height-y-1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);return {...sample,rgba:Array.from(rgba)};});
  return {...config,pixels};
};
(window as any).oracleSpec={schema:1,three:THREE.REVISION,width,height,fov,eye,background,backgroundDepth:220,backgroundScale:1.92,
  clear,fog:{color:fogColor,near:0,far:200},tiles,configurations:configurations.map(c=>c.name),
  scope:'Actual Three MeshBasic opaque/transparent/cutout plus toneMapped policies, linear fog and source bloom/world grading. Interior samples do not validate antialiasing or lit BRDF.'};
