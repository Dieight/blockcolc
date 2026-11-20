package com.blockcolc.world.generation

import java.nio.DoubleBuffer
import java.nio.IntBuffer
import java.util.Collections
import java.util.concurrent.CancellationException
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot

enum class WorldEnvironment(val wireValue:String) {
    VALLEY("natural-valley"),FLOATING("classic-island"),OCEAN("ocean-island"),COAST("mosaic-coast");
    companion object {
        fun fromWire(value:String)=entries.firstOrNull{it.wireValue==value}
            ?:throw IllegalArgumentException("Unknown world environment")
    }
}

data class TerrainPad(val x:Double,val z:Double,val width:Double,val depth:Double,val groundLevel:Double) {
    init { require(listOf(x,z,width,depth,groundLevel).all{it.isFinite()}&&width>0&&depth>0) }
}

class SupportedVillage internal constructor(placements:List<VillagePlacement>,pads:List<TerrainPad>) {
    val placements:List<VillagePlacement> = Collections.unmodifiableList(placements.toList())
    /** Building pads only. Rewards must use the generated surface afterwards,
     * otherwise each reward would flatten another part of the world. */
    val pads:List<TerrainPad> = Collections.unmodifiableList(pads.toList())
}

class RoadGeometry internal constructor(private val coordinates:DoubleArray,private val triangles:IntArray,val cellCount:Int) {
    val vertexCount get()=coordinates.size/3
    val triangleCount get()=triangles.size/3
    fun positions():DoubleBuffer=DoubleBuffer.wrap(coordinates).asReadOnlyBuffer()
    fun indices():IntBuffer=IntBuffer.wrap(triangles).asReadOnlyBuffer()
}

/** Inhabited support datum, not a substitute for the distant V4 terrain.
 * The same datum feeds building pads and roads, including the raised ocean
 * terrace. Geometry stays Double until its renderer upload boundary. */
object SettlementSupport {
    private fun checkpoint(cancelled:()->Boolean) {
        if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Settlement support superseded")
    }
    private fun onPad(x:Double,z:Double,pad:TerrainPad)=abs(x-pad.x)<=pad.width/2+1&&abs(z-pad.z)<=pad.depth/2+1
    private fun onBuilding(x:Double,z:Double,p:VillagePlacement)=abs(x-p.worldPosition.x)<=p.footprint.width/2+1&&abs(z-p.worldPosition.z)<=p.footprint.depth/2+1

    /** Mainland rewards can start far from their plot. On the floating island
     * start the collision search near the host while preserving the bearing. */
    fun floatingRewardOffset(host:VillagePlacement,reward:FootprintBounds,saved:Position2):Position2 {
        val distance=hypot(saved.x,saved.z)
        val reach=(hypot(host.footprint.width,host.footprint.depth)+hypot(reward.width.toDouble(),reward.depth.toDouble()))/2+8
        if(distance<=reach)return saved
        val scale=reach/distance
        return Position2(saved.x*scale,saved.z*scale)
    }

    fun groundHeightAt(x:Double,z:Double,environment:WorldEnvironment,placements:List<VillagePlacement> = emptyList(),pads:List<TerrainPad> = emptyList()):Double {
        var height=VillageLayout.terrainHeightAt(x,z)
        if(environment==WorldEnvironment.OCEAN)height=maxOf(4.0,height)
        for(pad in pads)if(onPad(x,z,pad))height=maxOf(height,pad.groundLevel)
        for(p in placements)if(onBuilding(x,z,p))height=maxOf(height,p.worldPosition.y)
        return height
    }

    fun placementHeight(p:VillagePlacement,environment:WorldEnvironment,cancelled:()->Boolean={false}):Double {
        checkpoint(cancelled)
        require(listOf(p.worldPosition.x,p.worldPosition.y,p.worldPosition.z,p.footprint.width,p.footprint.depth).all{it.isFinite()})
        require(p.footprint.width>0&&p.footprint.depth>0)
        val minX=floor(p.worldPosition.x-p.footprint.width/2)
        val maxX=ceil(p.worldPosition.x+p.footprint.width/2)
        val minZ=floor(p.worldPosition.z-p.footprint.depth/2)
        val maxZ=ceil(p.worldPosition.z+p.footprint.depth/2)
        // Layout uses small local coordinates. Refuse a Double range where
        // adding one ceases to advance rather than looping forever.
        require(listOf(minX,maxX,minZ,maxZ).all{it in -9_007_199_254_740_990.0..9_007_199_254_740_990.0})
        var support=if(environment==WorldEnvironment.OCEAN)4.0 else p.worldPosition.y
        var x=minX;var samples=0
        while(x<=maxX) {
            checkpoint(cancelled)
            var z=minZ
            while(z<=maxZ) {
                if(samples++%256==0)checkpoint(cancelled)
                support=maxOf(support,groundHeightAt(x,z,environment));z+=1
            }
            x+=1
        }
        for(cornerX in listOf(minX,maxX))for(cornerZ in listOf(minZ,maxZ))
            support=maxOf(support,groundHeightAt(cornerX,cornerZ,environment))
        checkpoint(cancelled)
        return maxOf(p.worldPosition.y,support)
    }

    fun align(placements:List<VillagePlacement>,environment:WorldEnvironment,cancelled:()->Boolean={false}):SupportedVillage {
        checkpoint(cancelled)
        val aligned=placements.map { p ->
            val initially=if(environment==WorldEnvironment.OCEAN&&p.worldPosition.y<4)p.copy(worldPosition=p.worldPosition.copy(y=4.0))else p
            val y=placementHeight(initially,environment,cancelled)
            if(y>initially.worldPosition.y)initially.copy(worldPosition=initially.worldPosition.copy(y=y))else initially
        }
        val pads=aligned.map{TerrainPad(it.worldPosition.x,it.worldPosition.z,it.footprint.width,it.footprint.depth,it.worldPosition.y)}
        checkpoint(cancelled)
        return SupportedVillage(aligned,pads)
    }

    fun roads(roads:List<RoadCell>,placements:List<VillagePlacement>,pads:List<TerrainPad>,environment:WorldEnvironment,cancelled:()->Boolean={false}):RoadGeometry {
        checkpoint(cancelled)
        require(roads.size<=Int.MAX_VALUE/12){"Road geometry exceeds addressable buffers"}
        val positions=DoubleArray(roads.size*12);val indices=IntArray(roads.size*6)
        for((index,road)in roads.withIndex()) {
            if(index%128==0)checkpoint(cancelled)
            val y=groundHeightAt(road.x.toDouble(),road.z.toDouble(),environment,placements,pads)-.455
            val offset=index*12;val x=road.x.toDouble();val z=road.z.toDouble()
            positions[offset]=x-.49;positions[offset+1]=y;positions[offset+2]=z-.49
            positions[offset+3]=x-.49;positions[offset+4]=y;positions[offset+5]=z+.49
            positions[offset+6]=x+.49;positions[offset+7]=y;positions[offset+8]=z+.49
            positions[offset+9]=x+.49;positions[offset+10]=y;positions[offset+11]=z-.49
            val vertex=index*4;val i=index*6
            indices[i]=vertex;indices[i+1]=vertex+1;indices[i+2]=vertex+2
            indices[i+3]=vertex;indices[i+4]=vertex+2;indices[i+5]=vertex+3
        }
        checkpoint(cancelled)
        return RoadGeometry(positions,indices,roads.size)
    }
}
