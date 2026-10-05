import type { BlueprintVoxel, MaterialId } from './blueprint-model';
/** Self-authored block keepsakes; downloaded textures are optional. */
export function holidayBuildingBlueprint(id:string,title:string) {
 const cells=new Map<string,BlueprintVoxel>();
 const put=(x:number,y:number,z:number,b:string,m:MaterialId='accent')=>cells.set(`${x}:${y}:${z}`,{x,y,z,materialId:m,buildOrder:0,sourceBlockId:`minecraft:${b}`,...(b==='lantern'?{sourceBlockState:{hanging:'true',waterlogged:'false'},emissiveKind:'lantern',emissiveLevel:15}:{})});
 const box=(x0:number,x1:number,y0:number,y1:number,z0:number,z1:number,b:string,m:MaterialId='accent')=>{for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)put(x,y,z,b,m);};
 box(-5,5,0,0,-4,4,'stone_bricks','stone');
 const garden=(flower:string)=>{for(const x of [-4,-3,3,4])for(let z=-3;z<=3;z++){put(x,1,z,'grass_block');if((x+z)%2===0)put(x,2,z,flower);}};
 const bench=()=>{box(-2,2,1,1,3,3,'oak_slab','plank');for(const x of [-2,2])put(x,2,3,'oak_fence','wood');};
 const pavilion=(a:string,b=a)=>{for(const x of [-3,3])for(const z of [-2,2])box(x,x,1,4,z,z,'oak_log','wood');for(let x=-4;x<=4;x++)for(let z=-3;z<=3;z++)put(x,5,z,(x+z)%2===0?a:b,'roof');};
 const lamps=()=>{for(const x of [-2,2])put(x,4,0,'lantern','glass');};
 const gifts=()=>{box(-4,-3,1,2,-3,-2,'red_concrete');box(3,4,1,2,2,3,'yellow_concrete');for(const x of [-4,-3])put(x,2,-2,'white_concrete');};
 const fir=()=>{box(0,0,1,7,0,0,'spruce_log','wood');for(let y=3;y<=8;y++){const r=Math.max(0,Math.floor((8-y)/2));for(let x=-r;x<=r;x++)for(let z=-r;z<=r;z++)if(Math.abs(x)+Math.abs(z)<=r+1)put(x,y,z,'spruce_leaves');}put(0,9,0,'glowstone','glass');};
 const sparks=(palette:readonly string[])=>{for(const [i,x]of [-3,3].entries()){box(x,x,1,5,0,0,'iron_bars','stone');for(const [dx,dy,dz]of [[0,2,0],[2,0,0],[-2,0,0],[0,-2,0],[0,0,2],[0,0,-2]])put(x+dx!,6+dy!,dz!,palette[i%palette.length]!);}};
 switch(id){
 case'new-year':sparks(['yellow_concrete','cyan_concrete']);gifts();break;
 case'spring-festival':pavilion('red_terracotta','dark_oak_planks');lamps();bench();break;
 case'valentine':garden('rose_bush');box(0,0,1,3,0,0,'oak_fence','wood');box(-1,1,4,4,0,1,'red_concrete');put(0,4,2,'oak_trapdoor','wood');bench();break;
 case'lantern':pavilion('red_concrete','yellow_concrete');for(const x of [-2,0,2]){put(x,3,0,'yellow_stained_glass','glass');put(x,2,0,'red_concrete');put(x,4,0,'lantern','glass');}break;
 case'women':garden('dandelion');box(-2,2,1,2,-3,-3,'bookshelf','plank');bench();break;
 case'nowruz':for(const x of [-3,3])box(x,x,1,4,-2,2,'glass','glass');for(const z of [-2,2])box(-3,3,1,4,z,z,'glass','glass');box(-3,3,5,5,-2,2,'glass','glass');garden('poppy');put(0,1,0,'moss_block');put(0,2,0,'oak_sapling');break;
 case'songkran':box(-4,0,1,1,-2,2,'water','glass');for(const [x,y]of [[2,1],[1,2],[3,2],[0,3],[4,3],[1,4],[3,4],[2,5]])put(x!,y!,0,'oak_planks','plank');box(2,2,2,4,0,0,'oak_log','wood');garden('cornflower');break;
 case'labour':pavilion('spruce_planks');put(-2,1,0,'crafting_table','plank');put(2,1,0,'anvil','stone');put(2,1,-2,'barrel','wood');bench();break;
 case'africa':pavilion('oak_leaves');garden('oxeye_daisy');box(-2,2,1,1,-3,-3,'bookshelf','plank');bench();break;
 case'children':box(-2,2,1,4,-2,2,'yellow_concrete');box(-3,3,5,5,-3,3,'light_blue_concrete','roof');for(let i=-3;i<=3;i++){put(i,5,3,'white_concrete');put(0,5+i,3,'white_concrete');}put(0,5,4,'red_concrete');gifts();break;
 case'dragon-boat':box(-4,4,1,1,-2,2,'light_blue_concrete');box(-4,4,2,2,-1,1,'oak_planks','plank');for(const x of [-4,4])box(x,x,3,3,-1,1,'oak_planks','plank');box(4,4,3,4,0,0,'lime_concrete');put(4,5,0,'yellow_concrete');for(const x of [-2,0,2])for(const z of [-2,2])put(x,3,z,'oak_slab','wood');break;
 case'france':sparks(['red_concrete','blue_concrete']);box(-2,2,1,1,-2,2,'quartz_block','stone');box(-1,1,2,2,-1,1,'water','glass');put(0,3,0,'white_concrete');break;
 case'us-independence':pavilion('red_concrete','white_concrete');sparks(['blue_concrete','white_concrete']);bench();break;
 case'china-national':pavilion('red_terracotta','yellow_concrete');lamps();bench();box(0,0,1,7,-3,-3,'iron_bars','stone');box(1,3,5,7,-3,-3,'red_concrete');put(1,6,-3,'yellow_concrete');break;
 case'mid-autumn':pavilion('dark_oak_planks');garden('dandelion');lamps();bench();break;
 case'oktoberfest':pavilion('blue_concrete','white_concrete');for(const x of [-2,0,2]){put(x,1,-1,'barrel','wood');put(x,2,-1,'wheat');}bench();break;
 case'halloween':box(-3,3,1,3,-2,-2,'orange_concrete');box(-3,-3,1,3,-1,2,'orange_concrete');box(3,3,1,3,-1,2,'orange_concrete');box(-3,3,4,4,-2,2,'dark_oak_planks','roof');put(-2,1,2,'jack_o_lantern');put(2,1,2,'jack_o_lantern');gifts();break;
 case'day-of-dead':garden('orange_tulip');for(const x of [-2,2])box(x,x,1,4,0,0,'oak_fence','wood');for(let x=-2;x<=2;x++)put(x,5,0,['yellow_concrete','magenta_concrete','cyan_concrete','orange_concrete','lime_concrete'][x+2]!);lamps();bench();break;
 case'christmas':fir();gifts();break;
 case'carnival':pavilion('magenta_concrete','yellow_concrete');box(-2,2,1,1,-2,1,'note_block','wood');for(const x of [-2,2]){put(x,2,0,'brown_concrete');put(x,3,0,'white_concrete');}break;
 default:throw new Error('Unknown holiday building');
 }
 const ordered=[...cells.values()].sort((a,b)=>a.y-b.y||a.x-b.x||a.z-b.z),maxY=Math.max(...ordered.map(v=>v.y));
 return{schemaVersion:1 as const,id:`builtin-holiday-${id}-v1`,title,bounds:{minX:-5,maxX:5,minY:0,maxY,minZ:-4,maxZ:4},voxels:ordered.map((v,i)=>({...v,buildOrder:Math.floor(i*10000/ordered.length),stage:'details' as const}))};
}
