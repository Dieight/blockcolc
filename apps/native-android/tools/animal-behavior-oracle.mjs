import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
const bundle=path=>buildSync({entryPoints:[fileURLToPath(new URL('../../../packages/voxel/src/'+path,import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text;
const importCode=code=>import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const {AnimalCommunity}=await importCode(bundle('animal-behavior.ts'));
const {AnimalHabitat}=await importCode(bundle('animal-habitat.ts'));
export function animalBehaviorOracle(){
  const surfaces=[{minX:-80,maxX:0,minZ:-80,maxZ:80,top:0,grass:true,water:false},
    {minX:0,maxX:80,minZ:-80,maxZ:80,top:0,grass:false,water:true}];
  const bounds={minX:-80,maxX:80,minZ:-80,maxZ:80},center={x:-10,y:0,z:0};
  const habitat=new AnimalHabitat(surfaces.map(s=>({...s,supportY:s.top+.5,material:s.water?'water':'grass'})),bounds,[],center);habitat.advance(Infinity);
  const community=new AnimalCommunity(habitat,'ocean-island',12345,()=>true);
  for(const [i,species]of ['silverfish','tropicalfish','salmon','gull','finch'].entries()){
    const kind=i<3?'fish':'bird',p=i<3?{x:20+i,y:-.6,z:i}:{x:-10-i*3,y:.08,z:i*3};
    const a=community.make(species,kind,p);a.remaining=i*.5+.02;if(kind==='fish'){a.waterY=0;a.school=1;a.jumpCooldown=0;}community.agents.push(a);
  }
  const initial=structuredClone({time:community.time,sequence:community.sequence,seed:community.seed,agents:community.agents});
  const frames=[];
  for(let i=0;i<600;i++){
    const dt=[.016,.033,.12,.2][i%4],motion=i<220||i>240,activityScale=i<300?1:.7;
    if(i===30)community.tap(1);if(i===90)community.tap(4);if(i===200)community.tap(2);
    if(i===150){const a=community.agents[1],to={x:a.position.x+Math.sin(a.heading)*1.4,y:a.position.y,z:a.position.z+Math.cos(a.heading)*1.4};
      a.route={from:{...a.position},to,control:{...to},height:1,t:0,duration:1.1};a.activity='jump';a.ripple=1;}
    const visible=new Set(community.agents.filter(a=>i%100<70||a.id!==5).map(a=>a.id));
    community.update(dt,motion,visible,activityScale);
    frames.push({dt,motion,activityScale,visible:[...visible],time:community.time,sequence:community.sequence,agents:structuredClone(community.agents)});
  }
  return {surfaces,bounds,center,landSeeds:habitat.landSeeds,initial,frames};
}
