import { AnimalHabitat, randomUnit } from './animal-habitat';
import { COW,HORSE,PIG,SHEEP,Navigator,Walker,type Body,type Point } from './animal-navigation';
import type {TerrainEnvironmentStyle} from './terrain';

export type AnimalSpecies='sheep'|'cow'|'pig'|'horse'|'silverfish'|'salmon'|'tropicalfish'|'gull'|'swallow'|'finch';
export type AnimalActivity='rest'|'graze'|'walk'|'swim'|'jump'|'perch'|'takeoff'|'fly'|'land';
export interface AnimalAgent {
  id:number; species:AnimalSpecies; kind:'land'|'fish'|'bird'; position:Point; heading:number; activity:AnimalActivity;
  remaining:number; phase:number; speed:number; traveled:number; response:number; reactions:number; ripple:number;
  walker?:Walker; route?:{from:Point;to:Point;control:Point;height:number;t:number;duration:number}; waterY?:number;
  jumpCooldown:number;
  school:number;
}
const bodies:Partial<Record<AnimalSpecies,Body>>={sheep:SHEEP,cow:COW,pig:PIG,horse:HORSE};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const smooth=(t:number)=>t*t*(3-2*t);
const angleMix=(a:number,b:number,t:number)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*Math.min(1,t);
export function speedForAnimal(a:AnimalAgent,time:number):number {
  const base=a.kind==='land'?bodies[a.species]!.speed:a.kind==='fish'?.85:2.5;
  return base*(.62+randomUnit(a.id*107+13)*.48+Math.sin(time*.53+a.phase)*.16+Math.sin(time*.19+a.phase*2)*.1)
    *(a.species==='horse'&&Math.sin(time*.13+a.phase)>.65?1.35:1);
}
export class AnimalCommunity {
  readonly agents:AnimalAgent[]=[];
  time=0; plans=0; cancelled=0; private sequence=0;private generation=0;private alive=true;private planning=false;
  constructor(readonly habitat:AnimalHabitat,readonly style:TerrainEnvironmentStyle,readonly seed:number,private readonly isActive:()=>boolean=()=>true){}
  random(){return randomUnit(this.seed+ ++this.sequence*269);}
  private make(species:AnimalSpecies,kind:AnimalAgent['kind'],position:Point):AnimalAgent {
    const id=this.agents.length+1;
    return {id,species,kind,position:{...position},heading:this.random()*Math.PI*2,activity:kind==='land'?'graze':kind==='fish'?'swim':'perch',
      remaining:1+this.random()*8,phase:this.random()*Math.PI*2,speed:0,traveled:0,response:0,reactions:0,ripple:0,jumpCooldown:20+this.random()*55,school:0};
  }
  *populate():Generator<void> {
    const land:AnimalSpecies[]=this.style==='natural-valley'?['sheep','cow','pig','horse','sheep','cow','pig','horse','sheep','pig']
      :this.style==='mosaic-coast'?['sheep','cow','pig','horse','sheep','pig','cow','horse']:[];
    for(const species of land){
      const nav=new Navigator(this.habitat.world,bodies[species]!,1,1024);
      for(const seed of this.habitat.landSeeds){
        const p=nav.nearest(seed,1);yield;
        if(!p||Math.abs(p.y-seed.y)>1.5||this.agents.some(a=>Math.hypot(a.position.x-p.x,a.position.z-p.z)<3))continue;
        const a=this.make(species,'land',p),walker=new Walker(nav,p);a.walker=walker;walker.heading=a.heading;
        walker.canOccupy=q=>this.agents.every(other=>other===a||other.kind!=='land'||Math.abs(other.position.y-q.y)>1.3
          ||Math.hypot(other.position.x-q.x,other.position.z-q.z)>nav.body.radius+bodies[other.species]!.radius+.08);
        this.agents.push(a);break;
      }
    }
    const fishCount=this.style==='classic-island'?0:this.style==='natural-valley'?8:15;
    const schools:Point[]=[];
    for(let i=0;i<fishCount;i++){
      for(let attempt=0;attempt<64;attempt++){
        const school=Math.floor(i/3),source=attempt<24&&schools[school]?schools[school]!
          :this.habitat.waterSeeds[(school*11+attempt)%this.habitat.waterSeeds.length];if(!source)break;
        const p={x:source.x+(this.random()-.5)*3,z:source.z+(this.random()-.5)*3,y:source.y-.45-this.random()*.45};
        if(this.habitat.swimClear(p)&&!this.agents.some(a=>a.kind==='fish'&&Math.hypot(a.position.x-p.x,a.position.z-p.z)<.7)){
          const a=this.make(this.style==='natural-valley'?'salmon':i%3===0?'tropicalfish':'silverfish','fish',p);
          a.waterY=this.habitat.waterAt(p.x,p.z);a.school=school+1;schools[school]??={x:p.x,y:a.waterY!,z:p.z};this.agents.push(a);break;
        }
        yield;
      }yield;
    }
    for(let i=0;i<8;i++){
      const available=this.habitat.landSeeds.filter(p=>this.agents.every(a=>a.kind==='fish'||Math.hypot(a.position.x-p.x,a.position.z-p.z)>(a.kind==='land'?3:2)));
      const source=available[(i*9)%available.length]??this.habitat.landSeeds[(i*9)%this.habitat.landSeeds.length]??this.habitat.center;
      const p={x:source.x,z:source.z,y:this.habitat.flightFloor(source.x,source.z)+.08};
      const sea=this.style==='ocean-island'||this.style==='mosaic-coast';
      const a=this.make(sea&&i%2===0?'gull':i%3===0?'swallow':'finch','bird',p);
      a.remaining=i*.8+1;this.agents.push(a);yield;
    }
  }
  tap(id:number):boolean {
    const a=this.agents.find(a=>a.id===id);if(!a)return false;
    a.response=1.3;a.reactions++;a.walker?.tap();if(a.kind==='fish')a.ripple=1;
    return true;
  }
  dispose(){this.alive=false;this.generation++;}
  async chooseWalk(a:AnimalAgent) {
    if(this.planning||!a.walker)return;this.planning=true;
    const generation=this.generation,origin={...a.position},nav=a.walker.navigator;
    try {
      // Relative, not home-centered: repeated trips can cross the entire
      // reachable world and its building district, without an invisible fence.
      for(let attempt=0;attempt<3;attempt++){
        const angle=a.heading+(this.random()-.5)*Math.PI*1.7,length=4+this.random()*12;
        const x=Math.round(origin.x+Math.sin(angle)*length),z=Math.round(origin.z+Math.cos(angle)*length);
        const goal=nav.column(x,z).filter(p=>Math.abs(p.y-origin.y)<4).sort((p,q)=>Math.abs(p.y-origin.y)-Math.abs(q.y-origin.y))[0];
        if(!goal)continue;
        const result=await nav.planCooperatively(origin,goal,()=>this.alive&&generation===this.generation&&this.isActive(),1200);
        if(result.route.reason==='cancelled'){this.cancelled++;return;}
        if(result.route.reason==='arrived'&&result.route.points.length>1){
          a.walker.adoptRoute(goal,result.route);a.walker.curve=(this.random()-.5)*.28;
          a.activity='walk';a.remaining=6+this.random()*10;this.plans++;return;
        }
      }
    } finally {this.planning=false;if(a.activity!=='walk')a.remaining=2+this.random()*5;}
  }
  update(seconds:number,motion:boolean,visible?:ReadonlySet<number>,activityScale=1) {
    const dt=Math.max(0,Math.min(.12,seconds));this.time+=dt;
    for(const a of this.agents){
      a.response=Math.max(0,a.response-dt);a.ripple=Math.max(0,a.ripple-dt*.8);
      if(!motion&&a.walker)a.walker.reactionRemaining=a.response;
      if(!motion||visible&&!visible.has(a.id))continue;
      a.remaining-=dt*Math.max(.25,Math.min(1,activityScale));a.speed=speedForAnimal(a,this.time)*(.8+.2*activityScale);
      if(a.kind==='land')this.updateLand(a,dt);
      else if(a.kind==='fish')this.updateFish(a,dt);
      else this.updateBird(a,dt);
    }
  }
  private updateLand(a:AnimalAgent,dt:number) {
    const walker=a.walker!;
    if(a.activity==='walk'){
      walker.speedScale=a.speed/walker.navigator.body.speed;walker.update(dt);
      a.position={...walker.position};a.heading=walker.heading;a.traveled=walker.traveled;
      if((!walker.moving||a.remaining<=0)&&this.habitat.world.supported(a.position,walker.navigator.body)){
        // Stop only on actual supported ground, never halfway through a jump.
        walker.route=null;a.activity=this.random()<.75?'graze':'rest';a.remaining=3+this.random()*9;
      }
    }else if(a.remaining<=0&&!a.response)void this.chooseWalk(a);
  }
  private updateFish(a:AnimalAgent,dt:number) {
    a.jumpCooldown=Math.max(0,a.jumpCooldown-dt);
    if(a.activity==='jump'&&a.route){
      const r=a.route;r.t=Math.min(1,r.t+dt/r.duration);
      a.position={x:mix(r.from.x,r.to.x,r.t),z:mix(r.from.z,r.to.z,r.t),y:mix(r.from.y,r.to.y,r.t)+Math.sin(r.t*Math.PI)*1.25};
      if(r.t>=1){a.activity='swim';a.remaining=5+this.random()*12;a.ripple=1;a.route=undefined;}return;
    }
    if(a.response>0)return;
    if(a.remaining<=0){a.activity=a.activity==='rest'?'swim':this.random()<.55?'rest':'swim';a.remaining=3+this.random()*(a.activity==='rest'?5:13);}
    if(a.activity==='rest')return;
    const neighbors=this.agents.filter(other=>other.kind==='fish'&&other.school===a.school&&other!==a&&Math.hypot(other.position.x-a.position.x,other.position.z-a.position.z)<8);
    let desired=a.heading+Math.sin(this.time*.7+a.phase)*dt*.7;
    if(neighbors.length){
      const center=neighbors.reduce((p,b)=>({x:p.x+b.position.x,z:p.z+b.position.z}),{x:0,z:0});
      desired=angleMix(desired,Math.atan2(center.x/neighbors.length-a.position.x,center.z/neighbors.length-a.position.z),dt*.3);
    }
    a.heading=angleMix(a.heading,desired,dt*2);
    const next={x:a.position.x+Math.sin(a.heading)*a.speed*dt,z:a.position.z+Math.cos(a.heading)*a.speed*dt,y:a.position.y};
    const surface=this.habitat.waterAt(next.x,next.z);
    if(surface!==undefined)next.y=surface-.6+Math.sin(this.time*.5+a.phase)*.14;
    if(this.habitat.swimClear(next)){a.traveled+=Math.hypot(next.x-a.position.x,next.z-a.position.z);a.position=next;a.waterY=surface;}
    else {a.heading+=dt*3.3;a.remaining=Math.min(a.remaining,2);}
    if(a.jumpCooldown<=0&&this.random()<dt/45&&surface!==undefined){
      const to={x:a.position.x+Math.sin(a.heading)*1.4,z:a.position.z+Math.cos(a.heading)*1.4,y:a.position.y};
      const mid={x:(to.x+a.position.x)/2,z:(to.z+a.position.z)/2,y:to.y};
      const clearFlight=Array.from({length:13},(_,i)=>i/12).every(t=>{
        const x=mix(a.position.x,to.x,t),z=mix(a.position.z,to.z,t),y=mix(a.position.y,to.y,t)+Math.sin(t*Math.PI)*1.25;
        return this.habitat.waterAt(x,z)!==undefined&&this.habitat.obstacleClear({x,y,z});
      });
      if(this.habitat.swimClear(to)&&this.habitat.swimClear(mid)&&clearFlight){
        a.route={from:{...a.position},to,control:mid,height:surface+1,t:0,duration:1.1};a.activity='jump';a.ripple=1;
        a.jumpCooldown=25+this.random()*60;
      }
    }
  }
  private updateBird(a:AnimalAgent,dt:number) {
    if(a.activity==='perch'){
      if(this.agents.some(other=>other.kind==='land'&&Math.hypot(other.position.x-a.position.x,other.position.z-a.position.z)<2.5))a.remaining=0;
      if(a.remaining>0||a.response)return;
      const angle=this.random()*Math.PI*2,length=8+this.random()*24;
      const to={x:a.position.x+Math.sin(angle)*length,z:a.position.z+Math.cos(angle)*length,y:0};
      if(a.species!=='gull'&&this.habitat.waterAt(to.x,to.z)!==undefined){
        const land=this.habitat.landSeeds.find(p=>Math.hypot(p.x-a.position.x,p.z-a.position.z)>6&&Math.hypot(p.x-a.position.x,p.z-a.position.z)<32);
        if(!land){a.remaining=3;return;}to.x=land.x;to.z=land.z;
      }
      if(to.x<this.habitat.bounds.minX+2||to.x>this.habitat.bounds.maxX-2||to.z<this.habitat.bounds.minZ+2||to.z>this.habitat.bounds.maxZ-2){a.remaining=2;return;}
      to.y=this.habitat.flightFloor(to.x,to.z)+.08;
      const control={x:(a.position.x+to.x)/2+Math.cos(angle)*length*.3,y:0,z:(a.position.z+to.z)/2-Math.sin(angle)*length*.3};
      let height=Math.max(a.position.y,to.y)+6;
      for(let t=0;t<=1;t+=.1){const x=(1-t)**2*a.position.x+2*(1-t)*t*control.x+t*t*to.x,z=(1-t)**2*a.position.z+2*(1-t)*t*control.z+t*t*to.z;
        height=Math.max(height,this.habitat.flightFloor(x,z)+4);}
      a.route={from:{...a.position},to,control,height,t:0,duration:length/2.8};a.activity='takeoff';return;
    }
    const r=a.route;if(!r)return;
    if(a.activity==='takeoff'){
      r.t=Math.min(1,r.t+dt*.75);a.position.y=mix(r.from.y,r.height,smooth(r.t));
      if(r.t>=1){a.activity='fly';r.t=0;}
    }else if(a.activity==='fly'){
      r.t=Math.min(1,r.t+dt*a.speed/2.5/r.duration);const t=r.t;
      const x=(1-t)**2*r.from.x+2*(1-t)*t*r.control.x+t*t*r.to.x,z=(1-t)**2*r.from.z+2*(1-t)*t*r.control.z+t*t*r.to.z;
      a.heading=angleMix(a.heading,Math.atan2(x-a.position.x,z-a.position.z),dt*5);a.traveled+=Math.hypot(x-a.position.x,z-a.position.z);
      a.position={x,z,y:r.height+Math.sin(t*Math.PI)*1.8};if(t>=1){a.activity='land';r.t=0;}
    }else{
      r.t=Math.min(1,r.t+dt*.75);a.position.y=mix(r.height,r.to.y,smooth(r.t));
      if(r.t>=1){a.position={...r.to};a.activity='perch';a.remaining=5+this.random()*12;a.route=undefined;}
    }
  }
}
