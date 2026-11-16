package com.blockcolc.world.generation

import java.util.Collections
import java.util.concurrent.CancellationException
import kotlin.math.*
import com.blockcolc.world.generation.SourceNumbers.hypot

enum class SceneryRole(val wireValue:String) {
    HOUSE("house"),WELL("well"),FARM("farm"),PATH("path"),TREE("tree"),GARDEN("garden"),
    DOCK("dock"),CAMP("camp"),WRECK("wreck"),RUIN("ruin"),ROCK("rock")
}

data class SceneryObject(val id:String,val role:SceneryRole,val x:Double,val y:Double,val z:Double,
    val width:Double,val depth:Double,val blocks:SceneryBlockSet) {
    val rect get()=SceneryRect(x,z,width,depth)
}

class WorldScenery internal constructor(val village:SceneryRect?,objects:List<SceneryObject>) {
    val objects:List<SceneryObject> = Collections.unmodifiableList(objects.toList())
}

/** Caller-owned lists are copied at the generation boundary. Surface columns
 * and block lists are immutable; no scenery object can flatten business plots. */
class WorldSceneryInput(val environment:WorldEnvironment,val seed:String,val surfaces:TerrainSurfaceTable,
    protectedRects:List<SceneryRect>,roads:List<RoadCell>,trees:List<TerrainTree>,
    val normalBounds:TerrainPlanBounds?=null,val mosaicCoreRadius:Double?=null) {
    val protectedRects:List<SceneryRect> = Collections.unmodifiableList(protectedRects.toList())
    val roads:List<RoadCell> = Collections.unmodifiableList(roads.toList())
    val trees:List<TerrainTree> = Collections.unmodifiableList(trees.toList())
    init {
        require(this.protectedRects.all{listOf(it.x,it.z,it.width,it.depth).all(Double::isFinite)&&it.width>0&&it.depth>0})
        require(mosaicCoreRadius==null||mosaicCoreRadius.isFinite()&&mosaicCoreRadius>=0)
        require(normalBounds==null||listOf(normalBounds.minX,normalBounds.maxX,normalBounds.minZ,normalBounds.maxZ).all(Double::isFinite)&&normalBounds.minX<=normalBounds.maxX&&normalBounds.minZ<=normalBounds.maxZ)
    }
}

/** Source-compatible deterministic scenery. This stage owns neither domain
 * rewards nor GPU resources. All work and scratch indices die with the call. */
object WorldSceneryPlanner {
    fun plan(input:WorldSceneryInput,cancelled:()->Boolean={false}):WorldScenery=Planning(input,cancelled).run()
    fun lod(projectedWidthPx:Double,distant:Boolean=false):Boolean=if(distant)projectedWidthPx<=42 else projectedWidthPx<30
    internal fun overlaps(a:SceneryRect,b:SceneryRect,gap:Double=0.0)=
        abs(a.x-b.x)<(a.width+b.width)/2+gap&&abs(a.z-b.z)<(a.depth+b.depth)/2+gap

    fun biome(seed:String,x:Double,z:Double,environment:WorldEnvironment,height:Double):String {
        if(environment in setOf(WorldEnvironment.VALLEY,WorldEnvironment.COAST)&&height>20)return "highland"
        val sx=x/32;val sz=z/32;val ix=floor(sx);val iz=floor(sz)
        fun smooth(t:Double)=t*t*(3-2*t)
        val tx=smooth(sx-ix);val tz=smooth(sz-iz)
        fun noise(dx:Int,dz:Int)=SourceNumbers.fnv32("$seed:biome:${SourceNumbers.text(ix+dx)}:${SourceNumbers.text(iz+dz)}")/4294967295.0
        val value=(noise(0,0)*(1-tx)+noise(1,0)*tx)*(1-tz)+(noise(0,1)*(1-tx)+noise(1,1)*tx)*tz
        return if(value<.42)"meadow"else if(value>.68&&environment!=WorldEnvironment.OCEAN)"birch-grove"else"oak-grove"
    }

    private data class Point(val x:Double,val z:Double) {fun rect(width:Double,depth:Double)=SceneryRect(x,z,width,depth)}
    private data class WaterSite(val point:Point,val y:Double)
    private data class TreeSite(val x:Double,val z:Double,val species:SceneryTreeSpecies?=null)
    private data class Module(val role:SceneryRole,val x:Int,val z:Int,val width:Int,val depth:Int,val blocks:SceneryBlockSet)

    private class Planning(val input:WorldSceneryInput,val cancelled:()->Boolean) {
        val environment=input.environment;val seed=input.seed
        val objects=ArrayList<SceneryObject>();val protected=input.protectedRects;val roads=input.roads
        val rows=ArrayList<TerrainSurface>();val distantLand=ArrayList<TerrainSurface>()
        var distantArea=0.0
        val exactMosaic=environment==WorldEnvironment.COAST&&input.mosaicCoreRadius!=null
        val coreX=if(exactMosaic||protected.isEmpty())0.0 else protected.sumOf{it.x}/protected.size
        val coreZ=if(exactMosaic||protected.isEmpty())0.0 else protected.sumOf{it.z}/protected.size
        val coreRadius=if(exactMosaic)input.mosaicCoreRadius!! else max(10.0,protected.maxOfOrNull{hypot(it.x-coreX,it.z-coreZ)+max(it.width,it.depth)/2}?:10.0)
        val compact=environment==WorldEnvironment.FLOATING
        val climateSeed=SourceNumbers.fnv32(seed).toInt();val mosaic=MosaicTerrain(climateSeed,coreRadius)
        val coldRegions=HashMap<TerrainCoordinate,Boolean>()
        val coldOffsets=listOf(-8 to 0,8 to 0,0 to -8,0 to 8,-6 to -6,-6 to 6,6 to -6,6 to 6)
        val roadBins=roads.groupBy{TerrainBucket(floor(it.x/8.0).toInt(),floor(it.z/8.0).toInt())}
        lateinit var landSites:List<Point>

        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Scenery planning superseded")}
        fun at(x:Double,z:Double)=input.surfaces.sample(x,z)
        fun hash(value:String)=SourceNumbers.fnv32(value)
        fun coordinates(p:Point)="${SourceNumbers.text(p.x)}:${SourceNumbers.text(p.z)}"
        fun center(s:TerrainSurface)=Point(TerrainMath.round((s.minX+s.maxX)/2),TerrainMath.round((s.minZ+s.maxZ)/2))
        fun distance(p:Point)=hypot(p.x-coreX,p.z-coreZ)
        fun <T> orderedBy(values:List<T>,score:(T)->Double):List<T> = values.map{it to score(it)}.sortedBy{it.second}.map{it.first}
        fun nearRoad(x:Double,z:Double,rangeX:Double,rangeZ:Double,inclusive:Boolean=false):Boolean {
            for(bx in floor((x-rangeX)/8).toInt()..floor((x+rangeX)/8).toInt())for(bz in floor((z-rangeZ)/8).toInt()..floor((z+rangeZ)/8).toInt()) {
                for(r in roadBins[TerrainBucket(bx,bz)].orEmpty()) {
                    val dx=abs(r.x-x);val dz=abs(r.z-z)
                    if(if(inclusive)dx<=rangeX&&dz<=rangeZ else dx<rangeX&&dz<rangeZ)return true
                }
            }
            return false
        }
        fun outsideNormal(x:Double,z:Double)=input.normalBounds?.let{x<it.minX||x>it.maxX||z<it.minZ||z>it.maxZ}?:false
        fun supports(cx:Double,cz:Double,width:Double,depth:Double):ScenerySupportRange? {
            var low=Double.POSITIVE_INFINITY;var high=Double.NEGATIVE_INFINITY
            for(dx in -floor(width/2).toInt()..floor(width/2).toInt()) {
                checkpoint()
                for(dz in -floor(depth/2).toInt()..floor(depth/2).toInt()) {
                    val x=cx+dx;val z=cz+dz;val s=at(x,z)?:return null
                    if(s.water||protected.any{overlaps(SceneryRect(x,z,1.0,1.0),it,2.0)}||nearRoad(x,z,2.0,2.0,true))return null
                    if(environment==WorldEnvironment.OCEAN&&(s.supportY>9||s.material==TerrainMaterial.STONE))return null
                    low=min(low,s.supportY);high=max(high,s.supportY)
                    if(high-low>4)return null
                }
            }
            return if(high-low<=4)ScenerySupportRange(low,high)else null
        }
        fun occupied(rect:SceneryRect,gap:Double=2.0)=protected.any{overlaps(rect,it,gap)}||objects.any{it.role!=SceneryRole.PATH&&overlaps(rect,it.rect,gap)}||nearRoad(rect.x,rect.z,(rect.width+1)/2+gap,(rect.depth+1)/2+gap)
        fun add(id:String,role:SceneryRole,p:Point,y:Double,width:Double,depth:Double,blocks:SceneryBlockSet) {
            objects+=SceneryObject("scenery:$seed:$id",role,p.x,y,p.z,width,depth,blocks)
        }
        fun footing(blocks:SceneryBlockSet,p:Point,datum:Double,block:String,material:String):SceneryBlockSet {
            val b=SceneryBlocksBuilder()
            for(v in blocks.voxels) {
                if(v.y!=0.0)continue
                val s=at(p.x+v.x,p.z+v.z)?:continue;if(s.water)continue
                var y= -1.0;val bottom=floor(s.supportY-datum+.001)
                while(y>=bottom){b.put(v.x,y,v.z,block,material);y--}
            }
            return b.result()
        }
        fun landStructure(role:SceneryRole,width:Int,depth:Int,blocks:SceneryBlockSet,preferredDistance:Double,accept:(Double,Double)->Boolean={_,_->true},suffix:String="") {
            checkpoint()
            val site=orderedBy(landSites.filter{accept(it.x,it.z)&&!occupied(it.rect(width.toDouble(),depth.toDouble()))},{abs(distance(it)-preferredDistance)})
                .firstOrNull{supports(it.x,it.z,width.toDouble(),depth.toDouble())!=null}?:return
            val datum=supports(site.x,site.z,width.toDouble(),depth.toDouble())!!.max
            add(role.wireValue+suffix,role,site,datum,width.toDouble(),depth.toDouble(),SceneryBlockSet.join(blocks,footing(blocks,site,datum,"stone","stone")))
        }
        fun villages():Pair<Point?,List<Module>> {
            val modules=listOf(
                Module(SceneryRole.HOUSE,-9,-7,9,11,SceneryBlocks.house(if(environment==WorldEnvironment.OCEAN)"birch"else"oak","spruce",true)),
                Module(SceneryRole.HOUSE,6,-8,9,11,SceneryBlocks.house("oak","oak")),
                Module(SceneryRole.HOUSE,-8,7,9,11,SceneryBlocks.house("oak","spruce")),
                Module(SceneryRole.WELL,3,4,7,7,SceneryBlocks.well()),Module(SceneryRole.FARM,11,8,7,7,SceneryBlocks.farm()))
            fun supported(p:Point)=modules.all{supports(p.x+it.x,p.z+it.z,it.width.toDouble(),it.depth.toDouble())!=null}
            fun score(p:Point)=abs(distance(p)-coreRadius-62)+abs(p.x-coreX-p.z+coreZ)*.55+max(0.0,p.x-coreX+p.z-coreZ)*.4
            data class Candidate(val point:Point,val score:Double,val tie:Long)
            val candidates=rows.filter{!it.water&&it.minX<it.maxX&&it.minZ<it.maxZ}.map(::center)
                .filter{distance(it)>=coreRadius+43&&distance(it)<=coreRadius+140}
                .map{Candidate(it,score(it),hash("$seed:${coordinates(it)}"))}
                .sortedWith(compareBy<Candidate>{it.score}.thenBy{it.tie}.thenBy{it.point.x}.thenBy{it.point.z}).map{it.point}
            val anchor=if(compact)null else candidates.firstOrNull{checkpoint();supported(it)}
            val anchors=ArrayList<Point>();anchor?.let{anchors+=it}
            val budget=if(compact)0 else min(3,max(1,1+floor(distantArea/1200000).toInt()))
            for(site in orderedBy(distantLand.map(::center),{hash("$seed:far-village:${coordinates(it)}").toDouble()})) {
                checkpoint();if(anchors.size>=budget||compact)break
                if(distance(site)<coreRadius+70||anchors.any{hypot(it.x-site.x,it.z-site.z)<180})continue
                if(supported(site))anchors+=site
            }
            for((index,a)in anchors.withIndex()) {
                checkpoint();val id=if(index==0)"village"else"far-village:${coordinates(a)}"
                for((i,m)in modules.withIndex()) {
                    val p=Point(a.x+m.x,a.z+m.z);val datum=supports(p.x,p.z,m.width.toDouble(),m.depth.toDouble())!!.max
                    add("$id:$i",m.role,p,datum,m.width.toDouble(),m.depth.toDouble(),SceneryBlockSet.join(footing(m.blocks,p,datum,"cobblestone","stone"),m.blocks))
                }
                val paths=SceneryBlocksBuilder()
                fun path(x:Int,z:Int) {
                    for(dx in 0..1) {
                        val s=at(a.x+x+dx,a.z+z)
                        if(s!=null&&!s.water&&modules.none{abs(x+dx-it.x)<it.width/2.0&&abs(z-it.z)<it.depth/2.0})paths.put(x+dx,s.supportY-.08,z,"dirt_path","wood")
                    }
                }
                for(m in modules) {
                    val endZ=m.z+ceil(m.depth/2.0).toInt()
                    for(x in min(0,m.x)..max(0,m.x))path(x,0)
                    for(z in min(0,endZ)..max(0,endZ))path(m.x,z)
                }
                add("$id:path",SceneryRole.PATH,a,0.0,33.0,29.0,paths.result())
            }
            return anchor to modules
        }
        fun coastLandmarks() {
            fun regions(vararg names:String):(Double,Double)->Boolean={x,z->mosaic.regionAt(x-coreX,z-coreZ) in names}
            landStructure(SceneryRole.CAMP,13,11,SceneryBlocks.camp("white_wool"),coreRadius+155,regions("11","12"),":snow")
            landStructure(SceneryRole.RUIN,9,9,SceneryBlocks.ruin(),coreRadius+180,regions("31","32"),":mesa")
            landStructure(SceneryRole.HOUSE,9,11,SceneryBlocks.house("poplar","spruce"),coreRadius+180,regions("33"),":forest")
            landStructure(SceneryRole.CAMP,13,11,SceneryBlocks.camp("orange_wool"),coreRadius+160,regions("33"),":forest")
            landStructure(SceneryRole.DOCK,7,15,SceneryBlocks.dock(),coreRadius+130,regions("23"),":coast")
            var spikes=0
            for(site in landSites) {
                checkpoint();if(spikes>=26)break
                val s=at(site.x,site.z)
                if(mosaic.regionAt(site.x-coreX,site.z-coreZ)!="21"||s==null||s.material !in setOf(TerrainMaterial.ICE,TerrainMaterial.SNOW)||occupied(site.rect(9.0,9.0),6.0))continue
                val datum=supports(site.x,site.z,7.0,7.0)?.max?:continue
                val blocks=SceneryBlocks.iceSpire(hash("$seed:${coordinates(site)}"))
                add("ice-spike:$spikes",SceneryRole.ROCK,site,datum,7.0,7.0,SceneryBlockSet.join(blocks,footing(blocks,site,datum,"packed_ice","glass")));spikes++
            }
            val spacing=max(116.0,coreRadius+84);val centerX=coreX+.25*spacing/sqrt(2.0);val centerZ=coreZ-1.55*spacing/sqrt(2.0)
            val radius=max(100.0,min(180.0,spacing*.70));val reach=radius*1.3;val dryStructures=objects.filter{it.role!=SceneryRole.PATH}.map{it.rect}
            var x=floor((centerX-reach)/40)*40
            while(x<=centerX+reach) {
                checkpoint();var z=floor((centerZ-reach)/40)*40
                while(z<=centerZ+reach) {
                    val originX=x;val originZ=z
                    fun seabed(dx:Double,dz:Double)=mosaic.seabedHeight(originX+dx-coreX,originZ+dz-coreZ)
                    val reef=ReefField.create(climateSeed,20.0,20.0,{dx,dz->
                        if(dx< -20||dx>=20||dz< -20||dz>=20)false else {
                            val wx=originX+dx;val wz=originZ+dz;val rect=SceneryRect(wx,wz,1.0,1.0)
                            at(wx,wz)?.water==true&&seabed(dx,dz)<= -6&&protected.none{overlaps(rect,it,2.0)}&&dryStructures.none{overlaps(rect,it,1.0)}
                        }
                    },ReefWorldField(originX,originZ,{dx,dz->floor(seabed(dx,dz)+.5)},{dx,dz->
                        SceneryClimate.reefDensity(climateSeed,originX+dx,originZ+dz,centerX,centerZ,radius,-seabed(dx,dz))*mosaic.warmSeaWeight(originX+dx-coreX,originZ+dz-coreZ)
                    }),cancelled)
                    if(reef.voxels.size>=12)add("reef:${SourceNumbers.text(x)}:${SourceNumbers.text(z)}",SceneryRole.ROCK,Point(x,z),0.0,40.0,40.0,reef)
                    z+=40
                };x+=40
            }
        }
        fun oceanLandmarks() {
            landStructure(SceneryRole.CAMP,13,11,SceneryBlocks.camp(),coreRadius+30)
            fun wreckAtShore(searchRadius:Double):WaterSite? {
                val water=LinkedHashMap<TerrainCoordinate,WaterSite>()
                for(land in landSites) {
                    checkpoint();if(distance(land)>=searchRadius)continue
                    for(offset in listOf(16,20,24,28))for((dx,dz)in listOf(offset to 0,-offset to 0,0 to offset,0 to -offset)) {
                        val p=Point(land.x+dx,land.z+dz);val s=at(p.x,p.z)
                        if(s?.water==true)water[TerrainCoordinate.at(p.x,p.z)]=WaterSite(p,s.supportY)
                    }
                }
                fun score(p:Point)=abs(distance(p)-coreRadius-33)+abs(p.x-coreX-p.z+coreZ)*.4+max(0.0,p.x-coreX+p.z-coreZ)*.5
                return water.values.filter{distance(it.point)>coreRadius+15}.sortedWith(compareBy<WaterSite>{score(it.point)}.thenBy{it.point.x}.thenBy{it.point.z}).firstOrNull{
                    val p=it.point
                    !occupied(p.rect(9.0,21.0),4.0)&&listOf(-4,0,4).all{dx->listOf(-10,0,10).all{dz->at(p.x+dx,p.z+dz)?.water==true}}&&
                        listOf(18 to 0,-18 to 0,0 to 18,0 to -18).any{(dx,dz)->at(p.x+dx,p.z+dz)?.water==false}
                }
            }
            val wreck=wreckAtShore(coreRadius+75)?:wreckAtShore(coreRadius*3+140)
            if(wreck!=null)add("wreck",SceneryRole.WRECK,wreck.point,wreck.y-.2,9.0,21.0,SceneryBlocks.wreck())
            val shore=landSites.firstOrNull{p->!occupied(p.rect(7.0,15.0))&&supports(p.x,p.z-5,5.0,5.0)!=null&&at(p.x,p.z+5)?.water==true&&at(p.x+2,p.z+7)?.water==true}
            if(shore!=null)add("dock",SceneryRole.DOCK,shore,max(at(shore.x,shore.z-5)!!.supportY,at(shore.x,shore.z+5)!!.supportY+.6),7.0,15.0,SceneryBlocks.dock())
        }
        fun coldTreeRegion(x:Double,z:Double):Boolean {
            if(environment!=WorldEnvironment.COAST)return false
            return coldRegions.getOrPut(TerrainCoordinate.at(x,z)) {
                at(x,z)?.material in setOf(TerrainMaterial.SNOW,TerrainMaterial.ICE)||mosaic.regionAt(x-coreX,z-coreZ)=="21"||mosaic.sample(x-coreX,z-coreZ).biome=="glacier"||
                    coldOffsets.any{(dx,dz)->at(x+dx,z+dz)?.material in setOf(TerrainMaterial.SNOW,TerrainMaterial.ICE)}
            }
        }
        fun trees(anchor:Point?) {
            val sites=ArrayList<TreeSite>()
            if(environment==WorldEnvironment.COAST) {
                val bounds=TerrainPlanBounds(rows.minOf{it.minX},rows.maxOf{it.maxX},rows.minOf{it.minZ},rows.maxOf{it.maxZ})
                sites.addAll(EcotoneTrees.plan(EcotoneTreeInput(climateSeed,coreX,coreZ,coreRadius,bounds,::at,::supports,::occupied),cancelled).map{TreeSite(it.x,it.z,it.species)})
            }else {
                sites.addAll(input.trees.map{TreeSite(it.x,it.z)})
                if(!compact&&input.normalBounds!=null) {
                    val budget=min(320,floor(sqrt(distantArea)/8).toInt());var count=0
                    for(site in if(budget>0)orderedBy(distantLand.map(::center),{hash("$seed:far-tree:${coordinates(it)}").toDouble()})else emptyList()) {
                        checkpoint();val s=at(site.x,site.z)
                        if(s==null||s.water||coldTreeRegion(site.x,site.z)||s.material!=TerrainMaterial.GRASS||occupied(site.rect(7.0,7.0))||sites.any{hypot(it.x-site.x,it.z-site.z)<14}||supports(site.x,site.z,3.0,3.0)==null)continue
                        sites+=TreeSite(site.x,site.z);if(++count>=budget)break
                    }
                }
                if(compact&&sites.isEmpty())for(site in landSites) {
                    checkpoint()
                    if(supports(site.x,site.z,5.0,5.0)!=null&&!occupied(site.rect(7.0,7.0))&&sites.all{hypot(it.x-site.x,it.z-site.z)>8})sites+=TreeSite(site.x,site.z)
                    if(sites.size>=3)break
                }
            }
            for((index,tree)in sites.withIndex()) {
                checkpoint();val x=TerrainMath.round(tree.x);val z=TerrainMath.round(tree.z);val p=Point(x,z)
                val mosaicBiome=if(environment==WorldEnvironment.COAST)mosaic.sample(x-coreX,z-coreZ).biome else null
                val poplar=tree.species?.let{it==SceneryTreeSpecies.POPLAR}?: (mosaicBiome=="forest")
                val taiga=tree.species?.let{it==SceneryTreeSpecies.SPRUCE}?:coldTreeRegion(x,z)
                val footprint=if(poplar)9.0 else if(taiga)7.0 else 5.0;val crown=p.rect(footprint+2,footprint+2)
                if(objects.any{it.role!=SceneryRole.PATH&&overlaps(crown,it.rect,2.0)}||protected.any{overlaps(crown,it,2.0)}||nearRoad(x,z,5.0,5.0))continue
                val s=at(x,z)?:continue
                if(s.water||s.material !in setOf(TerrainMaterial.GRASS,TerrainMaterial.SNOW)||supports(x,z,3.0,3.0)==null)continue
                val biome=biome(seed,x,z,environment,s.supportY)
                if(tree.species==null&&!poplar&&!taiga&&biome=="meadow"&&hash("$seed:open:${coordinates(p)}")%4!=0L)continue
                val species=tree.species?:if(poplar)SceneryTreeSpecies.POPLAR else if(taiga||biome=="highland")SceneryTreeSpecies.SPRUCE else if(biome=="birch-grove")SceneryTreeSpecies.BIRCH else SceneryTreeSpecies.OAK
                val variant=if(poplar)hash("$seed:poplar:${SourceNumbers.text(floor(x/24))}:${SourceNumbers.text(floor(z/24))}")else index.toLong()
                add("tree:$index",SceneryRole.TREE,p,s.supportY,footprint,footprint,SceneryBlocks.tree(species,variant,taiga))
            }
            if(anchor!=null)for((index,site)in listOf(Point(anchor.x-16,anchor.z-3),Point(anchor.x-12,anchor.z-13),Point(anchor.x+15,anchor.z+2)).withIndex()) {
                checkpoint();if(coldTreeRegion(site.x,site.z))continue
                val s=at(site.x,site.z)?:continue;val crown=site.rect(7.0,7.0)
                if(s.water||s.material!=TerrainMaterial.GRASS||supports(site.x,site.z,3.0,3.0)==null||objects.any{it.role!=SceneryRole.PATH&&overlaps(crown,it.rect,1.0)}||protected.any{overlaps(crown,it,2.0)}||nearRoad(site.x,site.z,5.0,5.0))continue
                add("village-tree:$index",SceneryRole.TREE,site,s.supportY,5.0,5.0,SceneryBlocks.tree(if(index==1)SceneryTreeSpecies.BIRCH else SceneryTreeSpecies.OAK,index.toLong()))
            }
        }
        fun gardens(anchor:Point?) {
            val meadowSites=landSites.filter{p->
                checkpoint()
                if(distance(p)>=coreRadius+(if(compact)20 else 60)||occupied(p.rect(9.0,7.0)))false else {
                    val s=at(p.x,p.z)
                    s!=null&&!s.water&&s.material==TerrainMaterial.GRASS&&biome(seed,p.x,p.z,environment,s.supportY)=="meadow"&&supports(p.x,p.z,9.0,7.0)!=null
                }
            }
            val sites=ArrayList<Point>();if(anchor!=null){sites+=Point(anchor.x-15,anchor.z+5);sites+=Point(anchor.x+6,anchor.z+14)}
            for(site in meadowSites) {
                if(sites.all{hypot(it.x-site.x,it.z-site.z)>18})sites+=site
                if(sites.size>=if(compact)2 else 6)break
            }
            if(!compact&&input.normalBounds!=null) {
                val budget=min(24,floor(sqrt(distantArea)/110).toInt());var count=0
                for(s in if(budget>0)orderedBy(distantLand,{hash("$seed:far-garden:${SourceNumbers.text(it.minX)}:${SourceNumbers.text(it.minZ)}").toDouble()})else emptyList()) {
                    checkpoint();if(s.material!=TerrainMaterial.GRASS)continue
                    val site=center(s)
                    if(biome(seed,site.x,site.z,environment,s.supportY)!="meadow"||occupied(site.rect(9.0,7.0))||sites.any{hypot(it.x-site.x,it.z-site.z)<24})continue
                    sites+=site;if(++count>=budget)break
                }
            }
            val flowers=listOf("poppy","dandelion","oxeye_daisy","cornflower")
            for((index,site)in sites.withIndex()) {
                checkpoint();if(supports(site.x,site.z,9.0,7.0)==null)continue
                val b=SceneryBlocksBuilder()
                for(dx in -4..4)for(dz in -3..3) {
                    if((dx/4.0).pow(2)+(dz/3.0).pow(2)>1||hash("$seed:flower:$dx:$dz:$index")%100>64)continue
                    val x=site.x+dx;val z=site.z+dz;val s=at(x,z)?:continue;val rect=SceneryRect(x,z,1.0,1.0)
                    if(s.water||s.material!=TerrainMaterial.GRASS||protected.any{overlaps(rect,it,2.0)}||nearRoad(x,z,2.0,2.0,true)||objects.any{it.role!=SceneryRole.PATH&&overlaps(rect,it.rect,1.0)})continue
                    b.put(dx,s.supportY,dz,flowers[(floor((dx+4)/3.0).toInt()+floor((dz+3)/3.0).toInt()+index)%flowers.size],"accent")
                }
                val blocks=b.result();if(blocks.voxels.isNotEmpty())add("garden:$index",SceneryRole.GARDEN,site,0.0,9.0,7.0,blocks)
            }
        }
        fun run():WorldScenery {
            checkpoint()
            for(i in 0 until input.surfaces.length) {
                if(i%256==0)checkpoint();val s=input.surfaces.at(i)!!;rows+=s
                if(!s.water&&outsideNormal((s.minX+s.maxX)/2,(s.minZ+s.maxZ)/2)){distantLand+=s;distantArea+=(s.maxX-s.minX)*(s.maxZ-s.minZ)}
            }
            if(rows.isEmpty())return WorldScenery(null,emptyList())
            val(anchor)=villages()
            landSites=orderedBy(rows.filter{!it.water}.map(::center).filter{distance(it)>coreRadius+(if(compact)6 else 15)},{hash("$seed:landmark:${coordinates(it)}").toDouble()})
            if(environment==WorldEnvironment.COAST)coastLandmarks()
            if(environment==WorldEnvironment.VALLEY) {
                landStructure(SceneryRole.CAMP,13,11,SceneryBlocks.camp(),coreRadius+27)
                landStructure(SceneryRole.RUIN,9,9,SceneryBlocks.ruin(),coreRadius+105)
            }else if(compact)landStructure(SceneryRole.ROCK,7,7,SceneryBlocks.rock(seed),coreRadius+12)
            else oceanLandmarks()
            trees(anchor);gardens(anchor);checkpoint()
            return WorldScenery(anchor?.rect(33.0,29.0),objects)
        }
    }
}
