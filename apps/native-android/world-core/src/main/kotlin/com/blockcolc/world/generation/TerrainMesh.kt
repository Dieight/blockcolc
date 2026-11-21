package com.blockcolc.world.generation

import java.nio.DoubleBuffer
import java.nio.IntBuffer
import com.blockcolc.world.NativePacketBuffers
import java.util.concurrent.CancellationException
import java.util.Collections
import kotlin.math.*

data class TerrainBounds(val minX:Double,val maxX:Double,val minY:Double,val maxY:Double,val minZ:Double,val maxZ:Double)
data class TerrainPlanBounds(val minX:Double,val maxX:Double,val minZ:Double,val maxZ:Double)
data class TerrainTree(val x:Double,val y:Double,val z:Double,val scale:Double)
data class TerrainLodCounts(val near:Int,val middle:Int,val far:Int)
data class TerrainWaterStats(val networks:Int,val basins:Int,val rivers:Int,val lakes:Int,val segments:Int,val outlets:Int,val maxUphill:Double,
    val protectedCells:Int,val waterArea:Double,val terrainArea:Double)
data class OceanIslet(val x:Double,val z:Double,val radius:Double,val peakHeight:Double)
data class OceanMain(val radius:Double,val beach:Double)

/** Immutable CPU mesh. Source-precision coordinates narrow only at upload;
 * callers get read-only independent buffer views, never mutable cache arrays. */
class TerrainMesh internal constructor(private val coordinates:DoubleBuffer,private val tops:Array<IntBuffer>,private val sides:Array<IntBuffer>,
    val cellCount:Int,val bounds:TerrainBounds,val framingBounds:TerrainPlanBounds,val nearDetailBounds:TerrainPlanBounds,
    trees:List<TerrainTree>,val lod:TerrainLodCounts,val hydrology:TerrainWaterStats,islets:List<OceanIslet>?,val oceanMain:OceanMain?) {
    internal constructor(coordinates:DoubleArray,tops:Array<IntArray>,sides:Array<IntArray>,cellCount:Int,bounds:TerrainBounds,framingBounds:TerrainPlanBounds,
        nearDetailBounds:TerrainPlanBounds,trees:List<TerrainTree>,lod:TerrainLodCounts,hydrology:TerrainWaterStats,islets:List<OceanIslet>?,oceanMain:OceanMain?):this(
        DoubleBuffer.wrap(coordinates).asReadOnlyBuffer(),Array(tops.size){IntBuffer.wrap(tops[it]).asReadOnlyBuffer()},Array(sides.size){IntBuffer.wrap(sides[it]).asReadOnlyBuffer()},
        cellCount,bounds,framingBounds,nearDetailBounds,trees,lod,hydrology,islets,oceanMain)
    val generationVersion=4
    val naturalTrees:List<TerrainTree> = Collections.unmodifiableList(trees.toList())
    val oceanIslets:List<OceanIslet>?=islets?.let{Collections.unmodifiableList(it.toList())}
    val vertexCount get()=coordinates.limit()/3
    val triangleCount get()=(tops.sumOf{it.limit()}+sides.sumOf{it.limit()})/3
    fun positions():DoubleBuffer=coordinates.asReadOnlyBuffer()
    fun topIndices(material:TerrainMaterial):IntBuffer=tops[material.ordinal].asReadOnlyBuffer()
    fun sideIndices(material:TerrainMaterial):IntBuffer {require(material==TerrainMaterial.DIRT||material==TerrainMaterial.STONE);return sides[if(material==TerrainMaterial.DIRT)0 else 1].asReadOnlyBuffer()}
    /** Keep the complete source-precision CPU mesh, but let Android place its
     * large immutable numbers outside ART just like render packet buffers.
     * This owns a copy; no mutable cache-file/input alias is retained. */
    fun inNativeStorage(cancelled:()->Boolean={false}):TerrainMesh {
        fun check(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Terrain storage superseded")}
        check();if(coordinates.isDirect||!NativePacketBuffers.hasPlatformAllocator)return this
        val points=NativePacketBuffers.doubles(coordinates.remaining()).also{it.put(coordinates.duplicate());(it as java.nio.Buffer).rewind()}.asReadOnlyBuffer()
        fun indices(source:Array<IntBuffer>)=Array(source.size){i->check();NativePacketBuffers.ints(source[i].remaining()).also{it.put(source[i].duplicate());(it as java.nio.Buffer).rewind()}.asReadOnlyBuffer()}
        val top=indices(tops);val side=indices(sides);check()
        return TerrainMesh(points,top,side,cellCount,bounds,framingBounds,nearDetailBounds,naturalTrees,lod,hydrology,oceanIslets,oceanMain)
    }
}

internal class TerrainDoubles {
    private var values=DoubleArray(4096);var size=0;private set
    operator fun get(index:Int):Double {require(index in 0 until size);return values[index]}
    fun add(vararg next:Double)=addAll(next)
    fun addAll(next:DoubleArray) {
        require(size<=Int.MAX_VALUE-next.size)
        if(size+next.size>values.size)values=values.copyOf(max(size+next.size,values.size*2))
        next.copyInto(values,size);size+=next.size
    }
    fun freeze():DoubleBuffer {
        if(!NativePacketBuffers.hasPlatformAllocator)return DoubleBuffer.wrap(values.copyOf(size)).asReadOnlyBuffer()
        // Publish straight to the Android backing store. An exact-size heap
        // copy of the growable array would coexist with it at peak usage.
        val out=NativePacketBuffers.doubles(size)
        out.put(values,0,size)
        (out as java.nio.Buffer).rewind()
        return out.asReadOnlyBuffer()
    }
}
internal class TerrainInts {
    private var values=IntArray(1024);var size=0;private set
    operator fun get(index:Int):Int {require(index in 0 until size);return values[index]}
    fun add(vararg next:Int) {
        require(size<=Int.MAX_VALUE-next.size)
        if(size+next.size>values.size)values=values.copyOf(max(size+next.size,values.size*2))
        next.copyInto(values,size);size+=next.size
    }
    fun freeze():IntBuffer {
        if(!NativePacketBuffers.hasPlatformAllocator)return IntBuffer.wrap(values.copyOf(size)).asReadOnlyBuffer()
        val out=NativePacketBuffers.ints(size)
        out.put(values,0,size)
        (out as java.nio.Buffer).rewind()
        return out.asReadOnlyBuffer()
    }
}

internal class TerrainMeshBuilder(private val checkpoint:()->Unit) {
    val positions=TerrainDoubles();val tops=Array(TerrainMaterial.entries.size){TerrainInts()};val sides=Array(2){TerrainInts()}
    fun top(vertices:DoubleArray,material:TerrainMaterial)=emit(vertices,tops[material.ordinal])
    fun side(vertices:DoubleArray,material:TerrainMaterial) {require(material==TerrainMaterial.DIRT||material==TerrainMaterial.STONE);emit(vertices,sides[if(material==TerrainMaterial.DIRT)0 else 1])}
    private fun emit(vertices:DoubleArray,indices:TerrainInts) {
        require(vertices.size==12)
        val start=positions.size/3;positions.addAll(vertices);indices.add(start,start+1,start+2,start,start+2,start+3)
    }
    fun closeCornerSlits() {
        fun rounded(value:Double)=TerrainMath.round(value*1000)/1000
        val heights=TerrainCornerIndex()
        val quadOffsets=intArrayOf(0,1,2,5) // emit always writes 0,1,2,0,2,3
        for(indices in tops) {var offset=0
            while(offset<indices.size) {
                if(offset%1536==0)checkpoint()
                for(corner in quadOffsets) {
                    val index=indices[offset+corner]*3
                    heights.addHeight(rounded(positions[index]),rounded(positions[index+2]),rounded(positions[index+1]))
                };offset+=6
            }
        }
        heights.prepareLines()
        val corners=DoubleArray(12)
        for(indices in sides) {var offset=0
            while(offset<indices.size) {
                if(offset%1536==0)checkpoint()
                for(corner in 0..3){val index=indices[offset+quadOffsets[corner]]*3;for(axis in 0..2)corners[corner*3+axis]=rounded(positions[index+axis])}
                var endCount=0;var first=0;var second=0;var bottom=Double.POSITIVE_INFINITY;var top=Double.NEGATIVE_INFINITY
                for(corner in 0..3){val a=corner*3;val b=(corner+1)%4*3;bottom=min(bottom,corners[a+1]);top=max(top,corners[a+1])
                    if(corners[a]==corners[b]&&corners[a+2]==corners[b+2]){if(endCount++==0)first=a else second=a}}
                offset+=6
                if(endCount!=2)continue
                val minX=min(corners[first],corners[second]);val maxX=max(corners[first],corners[second]);val minZ=min(corners[first+2],corners[second+2]);val maxZ=max(corners[first+2],corners[second+2])
                if(minX==maxX) {
                    heights.spansAlong(true,minX,minZ-.011,maxZ+.011,bottom,top)
                }else if(minZ==maxZ) {
                    heights.spansAlong(false,minZ,minX-.011,maxX+.011,bottom,top)
                }else {heights.spanAt(corners[first],corners[first+2],bottom,top);heights.spanAt(corners[second],corners[second+2],bottom,top)}
            }
        }
        for(point in 0 until heights.size) {
            if(point%256==0)checkpoint()
            val cursor=heights.uncoveredStart(point)?:continue;val high=heights.high(point);val x=heights.x(point);val z=heights.z(point)
            val material=if((cursor+high)/2>=12)1 else 0;val start=positions.size/3
            positions.add(x,cursor,z,x,high,z,x+.05,high,z,x+.05,cursor,z)
            sides[material].add(start,start+1,start+2,start,start+2,start+3,start,start+3,start+2,start,start+2,start+1)
        }
        checkpoint()
    }
    fun finish(cellCount:Int,bounds:TerrainBounds,framing:TerrainPlanBounds,near:TerrainPlanBounds,trees:List<TerrainTree>,lod:TerrainLodCounts,hydrology:TerrainWaterStats,
        islets:List<OceanIslet>?=null,main:OceanMain?=null):TerrainMesh {
        closeCornerSlits()
        val coordinates=positions.freeze()
        val top=Array(tops.size){checkpoint();tops[it].freeze()}
        val side=Array(sides.size){checkpoint();sides[it].freeze()}
        return TerrainMesh(coordinates,top,side,cellCount,bounds,framing,near,trees,lod,hydrology,islets,main)
    }
}

internal data class OceanRenderCell(val x:Double,val z:Double,val size:Double,val top:Double)
internal data class TerrainEdge(val start:Double,val end:Double,val top:Double)

/** Query order is original insertion order, not spatial sort order. */
internal class TerrainLineIntervals(private val intervals:List<TerrainEdge>) {
    private val order=intervals.indices.sortedWith(compareBy<Int>{intervals[it].start}.thenBy{it}).toIntArray()
    private val maximum=DoubleArray(order.size)
    init {var end=Double.NEGATIVE_INFINITY;for(i in order.indices){end=max(end,intervals[order[i]].end);maximum[i]=end}}
    fun overlapping(start:Double,end:Double):List<TerrainEdge> {
        var low=0;var high=order.size
        while(low<high){val mid=(low+high) ushr 1;if(maximum[mid]<=start)low=mid+1 else high=mid}
        val matches=ArrayList<Int>();var i=low
        while(i<order.size){val ordinal=order[i++];val interval=intervals[ordinal];if(interval.start>=end)break;if(interval.end>start)matches+=ordinal}
        if(matches.size>1)matches.sort()
        return matches.map{intervals[it]}
    }
}
