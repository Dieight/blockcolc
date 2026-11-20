package com.blockcolc.world.generation

import java.util.concurrent.CancellationException
import kotlin.math.*

data class TerrainOptions(val environment:WorldEnvironment=WorldEnvironment.FLOATING,val worldSeed:String="world-default",val generation:Int=4,val refinedFar:Boolean?=null)

/** Current V4 generator, independent of a renderer, database or fixed world
 * fixture. Generation owns temporary fields and publishes only a full mesh. */
object SteppedTerrain {
    const val REVISION=4
    fun generate(placements:List<VillagePlacement>,roads:List<RoadCell>,pads:List<TerrainPad> = emptyList(),minimumRadius:Position2?=null,
        options:TerrainOptions=TerrainOptions(),cancelled:()->Boolean={false}):TerrainMesh {
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Terrain generation superseded")}
        checkpoint();require(options.generation==4){"Migrate saved records before generating terrain"}
        require(minimumRadius==null||minimumRadius.x.isFinite()&&minimumRadius.z.isFinite())
        val p=placements.toList();val r=roads.toList();val extra=pads.toList()
        val radius=radius(p,r,extra,minimumRadius)
        val seed=SourceNumbers.fnv32(options.worldSeed).toInt();val profile=TerrainProfiles.forEnvironment(options.environment,radius,options.refinedFar)
        val ground={x:Double,z:Double->SettlementSupport.groundHeightAt(x,z,options.environment,p,extra)}
        return when(profile) {
            is TerrainProfile.Floating->floating(radius,seed,profile,ground,::checkpoint)
            is TerrainProfile.Regional->regional(p,r,extra,radius,seed,profile,ground,options.environment==WorldEnvironment.COAST,::checkpoint)
            is TerrainProfile.Ocean->OceanTerrainGenerator.generate(p,r,extra,radius,seed,profile,ground,::checkpoint)
        }
    }
    private fun radius(placements:List<VillagePlacement>,roads:List<RoadCell>,pads:List<TerrainPad>,minimum:Position2?):Double {
        var extentX=0.0;var extentZ=0.0
        fun cover(x:Double,z:Double){
            require(x.isFinite()&&z.isFinite())
            extentX=max(extentX,abs(x));extentZ=max(extentZ,abs(z))
        }
        for(road in roads)cover(road.x.toDouble(),road.z.toDouble())
        for(building in placements)cover(abs(building.worldPosition.x)+building.footprint.width/2,abs(building.worldPosition.z)+building.footprint.depth/2)
        for(pad in pads)cover(abs(pad.x)+pad.width/2,abs(pad.z)+pad.depth/2)
        return maxOf(26.0,minimum?.x?:0.0,minimum?.z?:0.0,hypot(extentX+9,extentZ+9))
    }

    /**
     * Allow the irregular rim and the terrain cell grid to extend beyond every
     * occupied footprint. The reward still sits on the sampled terrain, so
     * this does not add raised pads or move existing buildings.
     */
    fun floatingMinimumRadius(placements:List<VillagePlacement>,roads:List<RoadCell>,pads:List<TerrainPad>,
        existing:Position2?,rewards:List<DecorationPlacement>):Position2? {
        if(rewards.isEmpty())return existing
        val edge=rewards.maxOf{reward->
            hypot(abs(reward.worldPosition.x)+reward.footprint.width/2,abs(reward.worldPosition.z)+reward.footprint.depth/2)
        }
        val required=ceil((edge+3)/.98)
        return if(required>radius(placements,roads,pads,existing))Position2(required,required) else existing
    }
    private fun floating(radius:Double,seed:Int,profile:TerrainProfile.Floating,ground:(Double,Double)->Double,checkpoint:()->Unit):TerrainMesh {
        require(ceil(radius)<Int.MAX_VALUE)
        val cells=LinkedHashMap<TerrainBucket,Double>();var minimum=Double.POSITIVE_INFINITY;var maximum=Double.NEGATIVE_INFINITY
        val limit=ceil(radius).toInt();val size=profile.cellSize
        var x=-limit
        while(x<=limit) {
            checkpoint();var z=-limit
            while(z<=limit) {
                val normalized=(x/radius).pow(2)+(z/radius).pow(2)
                val noise=((TerrainMath.hash(seed,0x11,x.toDouble(),z.toDouble())%100)-50)/1500.0
                if(normalized+noise<=1) {
                    val height=ground(x.toDouble(),z.toDouble());cells[TerrainBucket(x,z)]=height;minimum=min(minimum,height);maximum=max(maximum,height)
                };z+=size
            };x+=size
        }
        val mesh=TerrainMeshBuilder(checkpoint);var visited=0
        for((cell,height)in cells) {
            if(visited++%128==0)checkpoint()
            val cx=cell.x.toDouble();val cz=cell.z.toDouble();val half=size/2.0;val top=height-.5
            mesh.top(doubleArrayOf(cx-half,top,cz-half,cx-half,top,cz+half,cx+half,top,cz+half,cx+half,top,cz-half),TerrainMaterial.GRASS)
            for((dx,dz)in directions) {
                val neighbor=cells[TerrainBucket(cell.x+dx*size,cell.z+dz*size)]?: -2.0
                val bottom=neighbor-.5;if(bottom>=top-.01)continue
                var cursor=bottom
                while(cursor<top-.01) {val end=min(top,cursor+1);emitSide(mesh,cx,cz,half,dx,dz,if(cursor+.5>=0)TerrainMaterial.DIRT else TerrainMaterial.STONE,cursor,end,if(dx!=0)cz-half else cx-half,if(dx!=0)cz+half else cx+half);cursor=end}
            }
        }
        val bounds=TerrainBounds(-radius,radius,minimum-.5,maximum+.5,-radius,radius);val framing=TerrainPlanBounds(-radius,radius,-radius,radius)
        return mesh.finish(cells.size,bounds,framing,framing,emptyList(),TerrainLodCounts(cells.size,0,0),TerrainWaterStats(0,0,0,0,0,0,0.0,0,0.0,cells.size*size.toDouble()*size))
    }
    private val directions=listOf(-1 to 0,1 to 0,0 to -1,0 to 1)
    internal fun lodSquare(extent:Double,inner:Double,size:Int,checkpoint:()->Unit,add:(Double,Double)->Unit) {
        var x=-extent+size/2.0
        while(x<extent) {
            checkpoint();var z=-extent+size/2.0
            while(z<extent){if(!(inner>0&&abs(x)<inner&&abs(z)<inner))add(x,z);z+=size};x+=size
        }
    }
    internal fun emitSide(mesh:TerrainMeshBuilder,x:Double,z:Double,half:Double,dx:Int,dz:Int,material:TerrainMaterial,bottom:Double,top:Double,start:Double,end:Double) {
        val vertices=when {
            dx<0->doubleArrayOf(x-half,bottom,end,x-half,top,end,x-half,top,start,x-half,bottom,start)
            dx>0->doubleArrayOf(x+half,bottom,start,x+half,top,start,x+half,top,end,x+half,bottom,end)
            dz<0->doubleArrayOf(start,bottom,z-half,start,top,z-half,end,top,z-half,end,bottom,z-half)
            else->doubleArrayOf(end,bottom,z+half,end,top,z+half,start,top,z+half,start,bottom,z+half)
        }
        mesh.side(vertices,material)
    }
    private fun regional(placements:List<VillagePlacement>,roads:List<RoadCell>,pads:List<TerrainPad>,radius:Double,seed:Int,profile:TerrainProfile.Regional,
        ground:(Double,Double)->Double,mosaic:Boolean,checkpoint:()->Unit):TerrainMesh {
        val support=TerrainSupportField(placements,roads,pads,ground);val field=RegionalTerrainField(radius,seed,profile,support,roads,mosaic,checkpoint)
        val mesh=TerrainMeshBuilder(checkpoint);val metrics=TerrainMetrics(seed)
        fun addCell(x:Double,z:Double,size:Int,lod:Int) {
            val sample=field.cellAt(x,z,size);val half=size/2.0;val top=sample.height-if(sample.material==TerrainMaterial.WATER).34 else .5
            mesh.top(doubleArrayOf(x-half,top,z-half,x-half,top,z+half,x+half,top,z+half,x+half,top,z-half),sample.material)
            for((dx,dz)in directions) {
                val acrossX=x+dx*size;val acrossZ=z+dz*size
                val near=abs(acrossX)<=profile.near&&abs(acrossZ)<=profile.near
                val middle=abs(acrossX)<=profile.middle&&abs(acrossZ)<=profile.middle
                val fine=profile.refinedFar&&abs(acrossX)<=profile.farFine&&abs(acrossZ)<=profile.farFine
                val neighborSize=if(near)2 else if(middle||fine)4 else profile.farCellSize
                val lattice=neighborSize/2.0
                fun snap(value:Double)=lattice+neighborSize*TerrainMath.round((value-lattice)/neighborSize)
                val acrossCellX=if(dx!=0)snap(x+dx*half+dx*neighborSize/2.0)else x
                val acrossCellZ=if(dz!=0)snap(z+dz*half+dz*neighborSize/2.0)else z
                val edgeStart=if(dx!=0)z-half else x-half;val edgeEnd=if(dx!=0)z+half else x+half
                val material=if(top>12)TerrainMaterial.STONE else TerrainMaterial.DIRT
                var center=snap(edgeStart)
                while(center-neighborSize/2.0<edgeEnd+.001) {
                    val start=max(edgeStart,center-neighborSize/2.0);val end=min(edgeEnd,center+neighborSize/2.0)
                    if(end-start>=.001) {
                        val neighbor=field.cellAt(if(dx!=0)acrossCellX else center,if(dz!=0)acrossCellZ else center,neighborSize)
                        val bottom=neighbor.height-if(mosaic&&neighbor.material==TerrainMaterial.WATER).34 else .5
                        if(bottom<top-.01)emitSide(mesh,x,z,half,dx,dz,material,bottom,top,start,end)
                    };center+=neighborSize
                }
            }
            metrics.add(x,z,size,lod,sample)
        }
        lodSquare(profile.near,0.0,2,checkpoint){x,z->addCell(x,z,2,0)}
        lodSquare(profile.middle,profile.near,4,checkpoint){x,z->addCell(x,z,4,1)}
        if(profile.refinedFar)lodSquare(profile.farFine,profile.middle,4,checkpoint){x,z->addCell(x,z,4,2)}
        lodSquare(profile.far,if(profile.refinedFar)profile.farFine else profile.middle,profile.farCellSize,checkpoint){x,z->addCell(x,z,profile.farCellSize,2)}
        val hydro=field.hydrology
        return mesh.finish(metrics.cells,TerrainBounds(-profile.far,profile.far,metrics.minimum-.5,metrics.maximum+.5,-profile.far,profile.far),
            TerrainPlanBounds(-radius,radius,-radius,radius),TerrainPlanBounds(-profile.near,profile.near,-profile.near,profile.near),metrics.trees,metrics.lod,
            metrics.water(hydro?.networkCount?:0,hydro?.basinCount?:0,hydro?.segmentCount?:0,hydro?.outletCount?:0,hydro?.maxUphillWaterStep?:0.0))
    }
}

internal class TerrainMetrics(private val seed:Int) {
    private val counts=IntArray(3);val trees=ArrayList<TerrainTree>()
    var minimum=Double.POSITIVE_INFINITY;private set;var maximum=Double.NEGATIVE_INFINITY;private set
    private var rivers=0;private var lakes=0;private var protected=0;private var waterArea=0.0;private var terrainArea=0.0
    val cells get()=counts.sum();val lod get()=TerrainLodCounts(counts[0],counts[1],counts[2])
    fun add(x:Double,z:Double,size:Int,lod:Int,sample:TerrainSample) {
        counts[lod]++;terrainArea+=size.toDouble()*size;minimum=min(minimum,sample.height);maximum=max(maximum,sample.height)
        if(sample.waterKind==TerrainWater.RIVER)rivers++;if(sample.waterKind==TerrainWater.LAKE)lakes++
        if(sample.waterKind!=TerrainWater.NONE){waterArea+=size.toDouble()*size;if(sample.supportInfluence>=.28)protected++}
        if(lod!=2&&size<=4&&sample.material==TerrainMaterial.GRASS&&sample.supportInfluence<.18&&sample.moisture>.06) {
            val hash=TerrainMath.hash(seed,0x771,TerrainMath.round(x),TerrainMath.round(z));val density=if(size==2)27 else 58
            if(hash%1000<density&&sample.height<19)trees+=TerrainTree(x,sample.height-.45,z,.82+hash%41/100.0)
        }
    }
    fun water(networks:Int,basins:Int,segments:Int,outlets:Int,uphill:Double)=TerrainWaterStats(networks,basins,rivers,lakes,segments,outlets,uphill,protected,waterArea,terrainArea)
}
