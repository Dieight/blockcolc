import {readFile} from 'node:fs/promises';
import {transformSync} from 'esbuild';
// Strip types, not algorithms. This module has no runtime imports or browser
// dependencies; parameter properties require esbuild rather than strip-only.
const raw=await readFile(new URL('../../../packages/voxel/src/animal-navigation.ts',import.meta.url),'utf8');
const code=transformSync(raw,{loader:'ts',format:'esm',target:'es2022'}).code;
const source=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const bounds={minX:-8,maxX:8,minZ:-8,maxZ:8};
const solid=(id,minX,maxX,minY,maxY,minZ,maxZ)=>({id,owner:'fixture',minX,maxX,minY,maxY,minZ,maxZ});
export function animalNavigationOracle() {
  const routes=[],edges=[],walkers=[];
  const flat=solid('floor',-8,8,-2,0,-8,8);
  const layouts=[
    {name:'flat',solids:[flat],height:0},
    {name:'wall-detour',solids:[flat,solid('wall',-.25,.25,0,3,-3,3)],height:0},
    {name:'half-step',solids:[flat,solid('step',0,8,0,.5,-8,8)],height:.5},
    {name:'full-step',solids:[flat,solid('step',0,8,0,1,-8,8)],height:1},
    {name:'too-high',solids:[flat,solid('cliff',0,8,0,2,-8,8)],height:2},
    {name:'river-gap',solids:[solid('left',-8,-.55,-2,0,-8,8),solid('right',.55,8,-2,0,-8,8)],height:0},
    {name:'thin-ledge',solids:[solid('ledge',-8,8,-2,0,-.33,.33)],height:0},
  ];
  const bodies=[source.SHEEP,source.COW,source.PIG,source.HORSE];
  for(const body of bodies)for(const layout of layouts){
    const start={x:-4,y:0,z:0},goal={x:4,y:layout.height,z:0},world=new source.CollisionWorld(bounds,layout.solids),nav=new source.Navigator(world,body,1,1024);
    const result=nav.plan(start,goal,1200);const {ms,...output}=result;
    routes.push({body,layout:layout.name,bounds,solids:layout.solids,start,goal,budget:1200,output});
  }
  for(const body of bodies)for(const rise of [-1,-.5,0,.5,1,2])for(const t of [0,.1,.28,.5,.8,1]){
    const a={x:0,y:0,z:0},b={x:1,y:rise,z:1};edges.push({body,a,b,t,action:source.edgeAction(a,b,body),point:source.edgePoint(a,b,t,body)});
  }
  for(const body of bodies)for(const edit of [false,true]){
    const start={x:-4,y:0,z:0},goal={x:4,y:0,z:0},world=new source.CollisionWorld(bounds,[flat]),nav=new source.Navigator(world,body,1,1024),walker=new source.Walker(nav,start);
    walker.setTarget(goal);const frames=[];
    for(let i=0;i<180;i++){
      if(i===5)walker.tap();if(edit&&i===80)world.replaceOwner('edit',[solid('new-wall',2,3,0,3,-1.5,1.5)]);
      const dt=[.016,.033,.12,.2][i%4];walker.speedScale=1+Math.sin(i/11)*.2;walker.curve=Math.sin(i/27)*.2;walker.update(dt);
      frames.push({dt,position:{...walker.position},heading:walker.heading,traveled:walker.traveled,reactionRemaining:walker.reactionRemaining,
        moving:walker.moving,replans:walker.replans,blocked:walker.blocked,droppedSeconds:walker.droppedSeconds});
    }
    walkers.push({body,bounds,solids:[flat],start,goal,edit,frames});
  }
  return {routes,edges,walkers};
}
