import * as THREE from 'three';
import {AnimalHabitat, type AnimalObstacle} from './animal-habitat';
import {AnimalCommunity, type AnimalAgent} from './animal-behavior';
import {AnimalModels} from './animal-models';
import {terrainSurfaceTable} from './terrain-surface-table';
import type {MergedGeometryData,TerrainEnvironmentStyle} from './terrain';
import type {Point} from './animal-navigation';

export interface AnimalDiagnostics {
  ready:boolean;count:number;land:number;fish:number;birds:number;moving:number;resting:number;reactions:number;
  navigationColumns:number;indexedVoxels:number;updates:number;updateMaxMs:number;preparationMaxSliceMs:number;
  collisionCacheShapes:number;
}
const equal=(a:AnimalObstacle,b:AnimalObstacle)=>a.id===b.id&&a.voxels===b.voxels&&a.rotation===b.rotation
  &&a.origin.x===b.origin.x&&a.origin.y===b.origin.y&&a.origin.z===b.origin.z&&a.offset?.x===b.offset?.x&&a.offset?.z===b.offset?.z;
export class WorldAnimals {
  readonly models=new AnimalModels();
  private habitat:AnimalHabitat|null=null;private community:AnimalCommunity|null=null;private populate:Generator<void>|null=null;
  private previous:readonly AnimalAgent[]=[];private key='';private lastAt=0;private lastFrameAt=0;private lastPoseAt=0;private live=false;private disposed=false;
  private visible=new Set<number>();private frustum=new THREE.Frustum();private matrix=new THREE.Matrix4();private point=new THREE.Vector3();
  private updates=0;private updateMaxMs=0;private preparationMaxSliceMs=0;
  constructor(readonly parent:THREE.Group,readonly style:TerrainEnvironmentStyle,readonly seed:number){parent.add(this.models.root);}
  sync(terrain:MergedGeometryData,key:string,sources:readonly AnimalObstacle[],center:Point){
    if(this.disposed)return;
    if(this.key===key&&this.habitat&&sources.length===this.habitat.sources.length&&sources.every((s,i)=>equal(s,this.habitat!.sources[i]!)))return;
    // Keep small poses, not old Walkers/nav graphs and their whole collision
    // world, while the replacement habitat is incrementally prepared.
    this.previous=this.community?.agents.map(({walker:_,...pose})=>pose)??[];this.community?.dispose();this.habitat?.cancel();this.populate?.return(undefined);
    this.key=key;this.models.clear();this.lastAt=this.lastFrameAt=this.lastPoseAt=0;this.community=null;this.populate=null;
    this.habitat=new AnimalHabitat(terrainSurfaceTable(terrain),terrain.bounds,sources,center);
  }
  suspend(){this.live=false;this.lastAt=this.lastFrameAt=0;}
  clear(){this.suspend();this.community?.dispose();this.habitat?.cancel();this.populate?.return(undefined);
    this.key='';this.previous=[];this.community=null;this.habitat=null;this.populate=null;this.visible.clear();this.models.clear();}
  tick(now:number,camera:THREE.Camera,visible:boolean,motion:boolean,activityScale=1):boolean {
    if(this.disposed||!visible||!this.habitat){this.suspend();return false;}
    this.live=motion;
    const began=performance.now();
    if(!this.habitat.ready){this.habitat.advance();this.preparationMaxSliceMs=Math.max(this.preparationMaxSliceMs,performance.now()-began);return false;}
    if(!this.community){this.community=new AnimalCommunity(this.habitat,this.style,this.seed,()=>this.live&&!this.disposed);this.populate=this.community.populate();}
    if(this.populate){
      let done=false;do{done=!!this.populate.next().done;}while(!done&&performance.now()-began<1.5);
      this.preparationMaxSliceMs=Math.max(this.preparationMaxSliceMs,performance.now()-began);
      if(!done)return false;
      this.populate=null;this.restorePositions();this.previous=[];this.models.root.visible=true;
    }
    if(this.lastFrameAt&&now-this.lastFrameAt<31)return false;
    const dt=this.lastAt?Math.min(.12,Math.max(0,(now-this.lastAt)/1000)):0;this.lastAt=now;this.lastFrameAt=now;
    this.parent.updateWorldMatrix(true,false);camera.updateMatrixWorld();
    this.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.matrix);
    const next=new Set<number>();
    for(const a of this.community.agents){this.point.set(a.position.x,a.position.y+.7,a.position.z).applyMatrix4(this.parent.matrixWorld);
      if(this.frustum.intersectsSphere(new THREE.Sphere(this.point,a.kind==='bird'?1.5:1.8)))next.add(a.id);}
    const changed=next.size!==this.visible.size||[...next].some(id=>!this.visible.has(id));this.visible=next;
    const responding=this.community.agents.some(a=>a.response>0||a.ripple>0);
    if(!motion&&!responding&&!changed&&this.updates>0)return false;
    this.community.update(dt,motion,this.visible,activityScale);
    const moving=this.community.agents.some(a=>this.visible.has(a.id)&&['walk','swim','jump','takeoff','fly','land'].includes(a.activity));
    if(!changed&&!responding&&!moving&&this.lastPoseAt&&now-this.lastPoseAt<180)return false;
    this.models.update(this.community.agents,this.community.time,this.visible);this.lastPoseAt=now;
    this.updates++;this.updateMaxMs=Math.max(this.updateMaxMs,performance.now()-began);
    return changed||this.visible.size>0;
  }
  private restorePositions(){
    for(const a of this.community!.agents){
      const old=this.previous.find(b=>b.id===a.id&&b.species===a.species);if(!old)continue;
      // An old flight/jump can cross newly built walls even when its current
      // point is still clear. Rebirth is safe; never adopt that stale trajectory.
      if(a.kind!=='land'&&old.route)continue;
      if(a.walker){
        const nav=a.walker.navigator;
        if(!nav.world.clear(old.position,nav.body)||!nav.world.supported(old.position,nav.body))continue;
        a.walker.position={...old.position};a.walker.heading=old.heading;a.activity='graze';a.remaining=2+(a.id%4);
      }else if(a.kind==='fish'&&!this.habitat!.swimClear(old.position))continue;
      else if(a.kind==='bird'&&old.position.y<this.habitat!.flightFloor(old.position.x,old.position.z))continue;
      else {a.activity=old.activity;a.remaining=old.remaining;a.route=old.route;}
      a.position={...old.position};a.heading=old.heading;a.traveled=old.traveled;a.reactions=old.reactions;
    }
  }
  tap(clientX:number,clientY:number,canvas:HTMLCanvasElement,camera:THREE.Camera,occluders:readonly THREE.Object3D[]):boolean {
    if(!this.community||this.populate||!this.models.root.visible)return false;
    const b=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((clientX-b.left)/b.width*2-1,-(clientY-b.top)/b.height*2+1),camera);
    this.models.root.updateWorldMatrix(true,true);
    const hit=ray.intersectObjects([this.models.parts,this.models.faces],false)[0];
    if(!hit||hit.instanceId===undefined)return false;
    const blocked=ray.intersectObjects([...occluders],true).some(other=>{
      if(other.distance>=hit.distance-.02||!(other.object instanceof THREE.Mesh))return false;
      for(let o:THREE.Object3D|null=other.object;o;o=o.parent)if(!o.visible)return false;
      const mats=Array.isArray(other.object.material)?other.object.material:[other.object.material];
      const mat=other.face?mats[other.face.materialIndex]:mats[0];
      return !!mat&&mat.visible&&mat.colorWrite&&(!mat.transparent||mat.opacity>.85);
    });
    if(blocked)return false;
    const id=this.models.animalForHit(hit.object,hit.instanceId);
    if(id===undefined||!this.community.tap(id))return false;
    this.models.update(this.community.agents,this.community.time,this.visible);return true;
  }
  diagnostics():AnimalDiagnostics {
    const a=this.community?.agents??[];
    return {ready:!!this.community&&!this.populate,count:a.length,land:a.filter(a=>a.kind==='land').length,fish:a.filter(a=>a.kind==='fish').length,birds:a.filter(a=>a.kind==='bird').length,
      moving:a.filter(a=>['walk','swim','jump','takeoff','fly','land'].includes(a.activity)).length,resting:a.filter(a=>['rest','graze','perch'].includes(a.activity)).length,
      reactions:a.reduce((n,a)=>n+a.reactions,0),navigationColumns:a.reduce((n,a)=>n+(a.walker?.navigator.stats().columns??0),0),indexedVoxels:this.habitat?.indexedVoxels??0,
      updates:this.updates,updateMaxMs:this.updateMaxMs,preparationMaxSliceMs:this.preparationMaxSliceMs,collisionCacheShapes:this.habitat?.stats().cachedShapes??0};
  }
  dispose(){this.disposed=true;this.suspend();this.community?.dispose();this.habitat?.cancel();this.populate?.return(undefined);this.previous=[];this.visible.clear();this.models.dispose();this.community=null;this.habitat=null;}
}
