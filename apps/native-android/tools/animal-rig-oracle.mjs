import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
const load=async name=>{
  const b=buildSync({entryPoints:[fileURLToPath(new URL('../../../packages/voxel/src/'+name,import.meta.url))],bundle:true,write:false,platform:'node',format:'esm'});
  return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
};
const {AnimalModels}=await load('animal-models.ts'),nav=await load('animal-navigation.ts');
export function animalRigOracle(){
  const models=new AnimalModels(),cases=[];
  for(const species of ['sheep','cow','pig','horse','silverfish','salmon','tropicalfish','gull','swallow','finch']){
    const kind=['sheep','cow','pig','horse'].includes(species)?'land':['silverfish','salmon','tropicalfish'].includes(species)?'fish':'bird';
    const activities=kind==='land'?['graze','rest','walk']:kind==='fish'?['swim','rest','jump']:['perch','takeoff','fly','land'];
    for(const activity of activities)for(const time of [0,1.234,8.9])for(const response of [0,.8]){
      const a={id:1,species,kind,position:{x:2.2,y:kind==='land'?.2:kind==='fish'?-.6:1,z:-1.3},heading:.6,activity,
        remaining:3,phase:.7,speed:1,traveled:2.2,response,reactions:1,ripple:kind==='fish'?.5:0,jumpCooldown:30,school:1,waterY:0};
      if(kind==='fish'&&activity==='jump')a.route={from:{...a.position},to:{...a.position,x:3},control:{...a.position},height:1,t:.3,duration:1.1};
      if(kind==='land'){
        const world=new nav.CollisionWorld({minX:-8,maxX:8,minZ:-8,maxZ:8},[{id:'floor',owner:'ground',minX:-8,maxX:8,minY:-2,maxY:0,minZ:-8,maxZ:8}]);
        a.walker=new nav.Walker(new nav.Navigator(world,[nav.SHEEP,nav.COW,nav.PIG,nav.HORSE].find(b=>b.id===species)),a.position);
      }
      models.update([a],time);const {walker,...agent}=a;
      cases.push({agent,time,meshes:[models.parts,models.faces,models.contacts,models.ripples].map(m=>({count:m.count,
        matrices:[...m.instanceMatrix.array.slice(0,m.count*16)],colors:[...m.instanceColor.array.slice(0,m.count*3)]}))});
    }
  }
  models.dispose();return cases;
}
