package com.blockcolc.world

import com.blockcolc.world.generation.*
import java.util.Collections
import java.util.concurrent.CancellationException
import kotlin.math.*

// Preserve the source V8 two-argument hypot ordering for equal-distance birth
// candidates. java.lang.Math.hypot can round these ties differently.
// Algorithm reference: https://github.com/v8/v8/blob/main/src/builtins/math.tq
private fun sourceAnimalDistance(x:Double,z:Double):Double {
    val scale=max(abs(x),abs(z));if(scale==0.0)return 0.0
    val a=x/scale;val b=z/scale;return sqrt(a*a+b*b)*scale
}

/** Current, intact physical voxels, in source order. Planned outlines and vines
 * are deliberately absent. The source key must identify the whole voxel input. */
data class NativeAnimalObstacle(val owner:String,val sourceKey:String,val voxels:List<RenderVoxel>,val origin:BlockPoint,
    val rotation:Double,val offset:Position2=Position2(0.0,0.0),val birthExclusion:AnimalBounds?=null)

/** Prepared CPU state only. Each renderer owns its mutable runtime and row
 * uploads; a scene can be safely adopted again after surface recreation. */
class NativeAnimalScene(val prepared:NativeAnimalPrepared,val initial:AnimalInitialState,val picking:NativeAnimalPickTemplate,val activityScale:Double=1.0){
    init{require(initial.bounds==prepared.bounds&&initial.center==prepared.center&&initial.landSeeds==prepared.landSeeds)
        require(activityScale.isFinite()&&activityScale in .25..1.0&&initial.agents.size<=64&&initial.agents.all{it.route==null&&it.walker==null})}
}

class NativeAnimalPrepared internal constructor(val habitat:AnimalHabitatInput,val bounds:AnimalBounds,val center:AnimalPoint,
    land:List<AnimalPoint>,water:List<AnimalPoint>,owners:Map<String,List<AnimalSolid>>) {
    val landSeeds:List<AnimalPoint> = Collections.unmodifiableList(land.toList())
    val waterSeeds:List<AnimalPoint> = Collections.unmodifiableList(water.toList())
    val owners:Map<String,List<AnimalSolid>> = Collections.unmodifiableMap(LinkedHashMap(owners))
    /** Birth probes stay near the supplied seeds: land uses a one-cell
     * nearest search, fish can jitter twice by 1.5 blocks, and birds probe
     * their seed or center. Eight blocks also cover all body/support radii.
     * Build this temporary lookup only; the renderer retains the full habitat
     * and animals can subsequently travel throughout the world. */
    internal fun birthHabitat(cancelled:()->Boolean):AnimalHabitatInput {
        checkpoint(cancelled)
        var minX=center.x;var maxX=center.x;var minZ=center.z;var maxZ=center.z
        for(p in landSeeds+waterSeeds){minX=min(minX,p.x);maxX=max(maxX,p.x);minZ=min(minZ,p.z);maxZ=max(maxZ,p.z)}
        minX-=8;maxX+=8;minZ-=8;maxZ+=8
        val nearby=ArrayList<AnimalSolid>()
        habitat.solids.forEachIndexed{i,s->
            if(i%256==0)checkpoint(cancelled)
            // Intersect the full bounds, not the center of a large obstacle.
            if(s.maxX>=minX&&s.minX<=maxX&&s.maxZ>=minZ&&s.minZ<=maxZ)nearby+=s
        }
        checkpoint(cancelled)
        return if(nearby.size==habitat.solids.size)habitat else habitat.withSolids(nearby)
    }
    /** Population and navigation preparation run on the generation worker.
     * This does not move animals or reopen a captured P1 fixture. */
    fun populate(style:WorldEnvironment,seed:Long,cancelled:()->Boolean={false}):AnimalInitialState {
        checkpoint(cancelled);require(seed in 0..0xffffffffL)
        val access=NativeAnimalHabitat(birthHabitat(cancelled),bounds,center,landSeeds)
        val agents=ArrayList<NativeAnimalAgent>();var sequence=0L
        fun random()=animalRandomUnit(seed+ ++sequence*269)
        fun make(species:String,kind:String,p:AnimalPoint):NativeAnimalAgent {
            val a=NativeAnimalAgent(agents.size+1,species,kind,p,random()*PI*2,
                if(kind=="land")"graze" else if(kind=="fish")"swim" else "perch",
                1+random()*8,random()*PI*2,jumpCooldown=20+random()*55)
            return a
        }
        val species=when(style){WorldEnvironment.VALLEY->listOf("sheep","cow","pig","horse","sheep","cow","pig","horse","sheep","pig")
            WorldEnvironment.COAST->listOf("sheep","cow","pig","horse","sheep","pig","cow","horse");else->emptyList()}
        for(kind in species){
            checkpoint(cancelled);val body=AnimalBodies.all.single{it.id==kind};val nav=AnimalNavigator(access.world,body,1.0,1024)
            for(birth in landSeeds){
                checkpoint(cancelled);val p=nav.nearest(birth,1)?:continue
                if(abs(p.y-birth.y)>1.5||agents.any{sourceAnimalDistance(it.position.x-p.x,it.position.z-p.z)<3})continue
                agents+=make(kind,"land",p);break
            }
        }
        val fishCount=when(style){WorldEnvironment.FLOATING->0;WorldEnvironment.VALLEY->8;else->15}
        val schools=HashMap<Int,AnimalPoint>()
        for(i in 0 until fishCount){for(attempt in 0 until 64){
            checkpoint(cancelled);val school=i/3
            val source=(if(attempt<24)schools[school]else null)?:waterSeeds.takeIf{it.isNotEmpty()}?.get((school*11+attempt)%waterSeeds.size)?:break
            // JS object construction consumes random x, z, then y, in this order.
            val x=source.x+(random()-.5)*3;val z=source.z+(random()-.5)*3;val p=AnimalPoint(x,source.y-.45-random()*.45,z)
            if(access.swimClear(p)&&agents.none{it.kind=="fish"&&sourceAnimalDistance(it.position.x-p.x,it.position.z-p.z)<.7}){
                val a=make(if(style==WorldEnvironment.VALLEY)"salmon"else if(i%3==0)"tropicalfish"else"silverfish","fish",p)
                a.waterY=access.waterAt(p.x,p.z);a.school=school+1
                schools.putIfAbsent(school,p.copy(y=checkNotNull(a.waterY)));agents+=a;break
            }
        }}
        for(i in 0 until 8){
            checkpoint(cancelled)
            val available=landSeeds.filter{p->agents.all{a->a.kind=="fish"||sourceAnimalDistance(a.position.x-p.x,a.position.z-p.z)>if(a.kind=="land")3 else 2}}
            val source=available.takeIf{it.isNotEmpty()}?.get(i*9%available.size)
                ?:landSeeds.takeIf{it.isNotEmpty()}?.get(i*9%landSeeds.size)?:center
            val sea=style==WorldEnvironment.OCEAN||style==WorldEnvironment.COAST
            val a=make(if(sea&&i%2==0)"gull"else if(i%3==0)"swallow"else"finch","bird",source.copy(y=access.flightFloor(source.x,source.z)+.08))
            a.remaining=i*.8+1;agents+=a
        }
        checkpoint(cancelled)
        return AnimalInitialState(bounds,center,landSeeds,seed and 0xffffffffL,sequence,0.0,Collections.unmodifiableList(agents))
    }
}

private fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Animal preparation superseded")}

/** Bounded, current-owner preparation. Terrain numeric rows are shared across
 * construction changes; only owners with changed source or placement recompile.
 * A failed candidate never replaces the last complete preparation. */
class NativeAnimalHabitatCompiler(private val colliderBudget:Long=64L*1024*1024) {
    private data class Key(val source:String,val origin:BlockPoint,val rotation:Double,val offset:Position2)
    private data class CachedOwner(val key:Key,val solids:List<AnimalSolid>)
    private data class GroundKey(val table:TerrainSurfaceTable,val center:AnimalPoint,val exclusions:List<AnimalBounds>)
    private data class Ground(val key:GroundKey,val habitat:AnimalHabitatInput,val land:List<AnimalPoint>,val water:List<AnimalPoint>)
    private val shapes=OriginalBlockShapes()
    private data class ShapeKey(val id:String?,val state:Map<String,String>?)
    private val shapeCache=LinkedHashMap<ShapeKey,OriginalBlockShape>()
    private var owners=emptyMap<String,CachedOwner>();private var ground:Ground?=null;private var previous:NativeAnimalPrepared?=null
    val retainedColliderEstimate:Long get()=owners.values.sumOf{it.solids.size*160L}
    init {require(colliderBudget in 0..(128L*1024*1024))}
    private val softNames=("torch soul_torch redstone_torch lantern soul_lantern grass short_grass tall_grass fern large_fern "+
        "poppy dandelion allium azure_bluet cornflower oxeye_daisy lily_of_the_valley lily_of_valley lily_pad wither_rose sunflower lilac rose_bush peony "+
        "open_eyeblossom closed_eyeblossom torchflower torchflower_crop pink_petals wildflowers leaf_litter vine glow_lichen "+
        "seagrass tall_seagrass kelp kelp_plant wheat carrots potatoes beetroots sugar_cane").split(' ').toSet()
    private val softSuffixes=arrayOf("_sapling","_tulip","_orchid","_wall_torch")
    private val invisible=setOf("minecraft:air","minecraft:cave_air","minecraft:void_air","minecraft:barrier","minecraft:light","minecraft:moving_piston","minecraft:structure_void")
    private fun soft(v:RenderVoxel):Boolean {
        val id=v.sourceBlockId?:"";val name=id.substringAfterLast(':');val state=v.sourceBlockState
        return name in softNames||softSuffixes.any{name.endsWith(it)}||id in invisible||
            id=="minecraft:pitcher_crop"&&state?.get("half")=="upper"&&state["age"] in setOf("0","1","2")||
            id.startsWith("minecraft:")&&id.endsWith("_wall")&&state?.get("up")=="false"&&listOf("north","south","west","east").all{state[it]=="none"}
    }
    fun obstacle(source:NativeAnimalObstacle,cancelled:()->Boolean={false}):List<AnimalSolid> {
        require(source.owner.length in 1..256&&source.sourceKey.isNotEmpty()&&source.voxels.size<=500000)
        require(listOf(source.origin.x,source.origin.y,source.origin.z,source.rotation,source.offset.x,source.offset.z).all{it.isFinite()})
        val c=cos(source.rotation);val s=sin(source.rotation);val output=ArrayList<AnimalSolid>()
        for((i,v)in source.voxels.withIndex()){
            if(i%128==0)checkpoint(cancelled);if(soft(v))continue
            val shapeKey=ShapeKey(v.sourceBlockId,v.sourceBlockState)
            val plan=shapeCache[shapeKey]?:shapes.plan(v).also{if(shapeCache.size>=4096)shapeCache.remove(shapeCache.keys.first());shapeCache[shapeKey]=it}
            // These source patterns are literal alternatives. Match directly
            // so every physical voxel does not allocate native ICU matchers.
            val id=v.sourceBlockId?:""
            val walkable=!(id.contains("fence")||id.contains("wall")||id.contains("pane")||id.contains("bars"))
            val water=id=="water"||id.endsWith(":water")
            for((part,box)in plan.boxes.withIndex()){
                var minX=Double.POSITIVE_INFINITY;var maxX=Double.NEGATIVE_INFINITY;var minZ=Double.POSITIVE_INFINITY;var maxZ=Double.NEGATIVE_INFINITY
                for(xSide in 0..1)for(zSide in 0..1){
                    val x=if(xSide==0)box.min.x else box.max.x;val z=if(zSide==0)box.min.z else box.max.z
                    val px=v.x+x+source.offset.x;val pz=v.z+z+source.offset.z
                    val wx=source.origin.x+px*c+pz*s;val wz=source.origin.z-px*s+pz*c
                    minX=min(minX,wx);maxX=max(maxX,wx);minZ=min(minZ,wz);maxZ=max(maxZ,wz)
                }
                val solid=AnimalSolid("${source.owner}:$i:$part",source.owner,minX,maxX,source.origin.y+v.y+box.min.y,source.origin.y+v.y+box.max.y,minZ,maxZ,
                    water,walkable)
                require(listOf(solid.minX,solid.maxX,solid.minY,solid.maxY,solid.minZ,solid.maxZ).all{it.isFinite()&&abs(it)<=1e6})
                require(output.size<500000&&(output.size+1)*160L<=colliderBudget){"Animal collider count budget"};output+=solid
            }
        }
        checkpoint(cancelled);return Collections.unmodifiableList(output)
    }
    fun prepare(table:TerrainSurfaceTable,bounds:AnimalBounds,center:AnimalPoint,sources:List<NativeAnimalObstacle>,cancelled:()->Boolean={false}):NativeAnimalPrepared {
        checkpoint(cancelled);require(sources.size<=4096&&sources.map{it.owner}.distinct().size==sources.size)
        require(listOf(bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ,center.x,center.y,center.z).all{it.isFinite()&&abs(it)<=1e6}&&bounds.minX<bounds.maxX&&bounds.minZ<bounds.maxZ)
        val groundKey=GroundKey(table,center,sources.mapNotNull{it.birthExclusion})
        val base=ground?.takeIf{it.key==groundKey}?:prepareGround(groundKey,cancelled)
        val next=LinkedHashMap<String,CachedOwner>();var estimate=0L;var count=0
        for(source in sources){
            checkpoint(cancelled);val key=Key(source.sourceKey,source.origin,source.rotation,source.offset)
            val entry=owners[source.owner]?.takeIf{it.key==key}?:CachedOwner(key,obstacle(source,cancelled))
            estimate+=entry.solids.size*160L;count+=entry.solids.size
            require(count<=500000&&estimate<=colliderBudget){"Animal collider world budget"};next[source.owner]=entry
        }
        val unchanged=ground===base&&previous?.bounds==bounds&&next.size==owners.size&&next.all{(owner,value)->owners[owner]===value}
        if(unchanged)return checkNotNull(previous)
        val ownerSolids=next.mapValues{it.value.solids}
        val input=base.habitat.withSolids(ownerSolids.values.flatten())
        val prepared=NativeAnimalPrepared(input,bounds,center,base.land,base.water,ownerSolids)
        checkpoint(cancelled);ground=base;owners=next;previous=prepared;return prepared
    }
    private fun prepareGround(key:GroundKey,cancelled:()->Boolean):Ground {
        val rows=ArrayList<AnimalSurface>();val land=ArrayList<AnimalPoint>();val water=ArrayList<AnimalPoint>();var landSeen=0;var waterSeen=0
        fun offer(list:MutableList<AnimalPoint>,p:AnimalPoint,seen:Int,row:Int){
            if(list.size<128)list+=p else {val slot=floor(animalRandomUnit(seen*31L+row)*seen).toInt();if(slot<128)list[slot]=p}
        }
        require(key.table.length<=500000)
        for(i in 0 until key.table.length){
            if(i%128==0)checkpoint(cancelled);val s=key.table.at(i)!!
            if(s.minX<s.maxX&&s.minZ<s.maxZ)rows+=AnimalSurface(s.minX,s.maxX,s.minZ,s.maxZ,s.supportY-.5,s.water,s.material==TerrainMaterial.GRASS)
            val x=(s.minX+s.maxX)/2;val z=(s.minZ+s.maxZ)/2
            if(abs(x-key.center.x)<160&&abs(z-key.center.z)<160){
                val p=AnimalPoint(floor(x+.5),s.supportY-.5,floor(z+.5))
                if(s.water)offer(water,p,++waterSeen,i+1)
                else if(s.material==TerrainMaterial.GRASS&&key.exclusions.none{b->p.x>=b.minX&&p.x<=b.maxX&&p.z>=b.minZ&&p.z<=b.maxZ})offer(land,p,++landSeen,i+1)
            }
        }
        fun distance(p:AnimalPoint)=sourceAnimalDistance(p.x-key.center.x,p.z-key.center.z)
        land.sortBy{distance(it)+if(it.x-key.center.x+it.z-key.center.z<0)18 else 0};water.sortBy{distance(it)}
        checkpoint(cancelled);return Ground(key,AnimalHabitatInput(rows,emptyList()),Collections.unmodifiableList(land),Collections.unmodifiableList(water))
    }
    fun clear(){owners=emptyMap();ground=null;previous=null;shapeCache.clear()}
}
