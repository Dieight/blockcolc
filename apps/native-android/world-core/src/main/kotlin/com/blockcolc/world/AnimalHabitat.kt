package com.blockcolc.world

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

data class AnimalSurface(override val minX:Double,override val maxX:Double,override val minZ:Double,override val maxZ:Double,
                         val top:Double,val water:Boolean,val grass:Boolean):AnimalFootprint

/** Compressed 8-block terrain index, same inclusive bin/input ordering as
 * source. It retains numeric rows rather than a per-coordinate history. */
class AnimalSurfaceIndex(surfaces:List<AnimalSurface>) {
    private val source=java.util.Collections.unmodifiableList(surfaces.toList())
    private var minX=0;private var minZ=0;private var width=0;private var height=0
    private val offsets:IntArray;private val rows:IntArray
    val byteSize:Long get()=source.size*48L+offsets.size*4L+rows.size*4L
    init {
        require(source.size<=500000)
        if(source.isEmpty()){offsets=IntArray(1);rows=IntArray(0)}else {
            for(s in source)require(listOf(s.minX,s.maxX,s.minZ,s.maxZ,s.top).all{it.isFinite()&&abs(it)<=1e6}&&s.minX<s.maxX&&s.minZ<s.maxZ)
            minX=source.minOf{floor(it.minX/8).toInt()};minZ=source.minOf{floor(it.minZ/8).toInt()}
            width=source.maxOf{floor(it.maxX/8).toInt()}-minX+1;height=source.maxOf{floor(it.maxZ/8).toInt()}-minZ+1
            require(width.toLong()*height in 1..1000000){"Animal ground index bounds budget"}
            var references=0L;for(s in source)references+=(floor(s.maxX/8)-floor(s.minX/8)+1).toLong()*(floor(s.maxZ/8)-floor(s.minZ/8)+1).toLong()
            require(references in 1..2000000){"Animal ground index reference budget"}
            offsets=IntArray(width*height+1);rows=IntArray(references.toInt())
            for(s in source)visit(s){offsets[it+1]++};for(i in 1 until offsets.size)offsets[i]+=offsets[i-1]
            val cursor=offsets.copyOf();for((i,s)in source.withIndex())visit(s){rows[cursor[it]++]=i}
        }
    }
    private inline fun visit(s:AnimalFootprint,work:(Int)->Unit){
        for(z in floor(s.minZ/8).toInt()..floor(s.maxZ/8).toInt())for(x in floor(s.minX/8).toInt()..floor(s.maxX/8).toInt())work((z-minZ)*width+x-minX)
    }
    fun query(b:AnimalBounds):List<AnimalSurface> {
        if(!listOf(b.minX,b.maxX,b.minZ,b.maxZ).all{it.isFinite()}||b.minX>=b.maxX||b.minZ>=b.maxZ||source.isEmpty())return emptyList()
        val seen=hashSetOf<Int>();val found=ArrayList<AnimalSurface>()
        val x0=max(0,floor(b.minX/8).toInt()-minX);val x1=min(width-1,floor(b.maxX/8).toInt()-minX)
        val z0=max(0,floor(b.minZ/8).toInt()-minZ);val z1=min(height-1,floor(b.maxZ/8).toInt()-minZ)
        for(z in z0..z1)for(x in x0..x1){val bin=z*width+x;for(i in offsets[bin] until offsets[bin+1]){
            val row=rows[i];if(!seen.add(row))continue;val s=source[row]
            if(s.minX<b.maxX&&s.maxX>b.minX&&s.minZ<b.maxZ&&s.maxZ>b.minZ)found+=s
        }}
        return found
    }
}

/** Validated read-only derived input. No file path or engine types in core. */
class AnimalHabitatInput private constructor(private val ground:Ground,solids:List<AnimalSolid>) {
    private class Ground(surfaces:List<AnimalSurface>){
        val surfaces:List<AnimalSurface> = java.util.Collections.unmodifiableList(surfaces.toList())
        val index:AnimalSurfaceIndex by lazy { AnimalSurfaceIndex(this.surfaces) }
    }
    constructor(surfaces:List<AnimalSurface>,solids:List<AnimalSolid>):this(Ground(surfaces),solids)
    val surfaces:List<AnimalSurface> get()=ground.surfaces
    val solids:List<AnimalSolid> = java.util.Collections.unmodifiableList(solids.toList())
    // Birth preparation and every renderer query the same immutable ground.
    // Build its bins once on the generation worker; only mutable collision
    // owners and agents belong to each runtime. No process-wide scene cache.
    internal val surfaceIndex:AnimalSurfaceIndex get()=ground.index
    internal fun withSolids(solids:List<AnimalSolid>)=AnimalHabitatInput(ground,solids)
    companion object {
        fun read(input:ByteBuffer,owners:List<String>):AnimalHabitatInput {
            val data=input.asReadOnlyBuffer().slice().order(ByteOrder.LITTLE_ENDIAN)
            require(data.remaining() in 32..(32*1024*1024)&&data.getInt(0)==0x31414342&&data.getInt(4)==1&&data.getInt(8)==data.remaining()){"Invalid BCA habitat envelope"}
            val surfaceCount=data.getInt(12);val solidCount=data.getInt(16)
            require(surfaceCount in 0..500000&&solidCount in 0..500000&&data.getInt(20)==owners.size&&data.getInt(24)==0&&data.getInt(28)==0)
            require(owners.size<=4096&&owners.distinct().size==owners.size&&owners.all{it.length in 1..256})
            require(data.remaining().toLong()==32L+surfaceCount*24L+solidCount*32L){"Truncated or unreferenced animal habitat"}
            fun n(at:Int)=data.getFloat(at).toDouble().also{require(it.isFinite()&&abs(it)<=1e6){"Invalid animal habitat coordinate"}}
            val surfaces=List(surfaceCount){i->val at=32+i*24;val flags=data.getInt(at+20);require(flags in 0..3)
                AnimalSurface(n(at),n(at+4),n(at+8),n(at+12),n(at+16),flags and 1!=0,flags and 2!=0).also{require(it.minX<it.maxX&&it.minZ<it.maxZ)}}
            val solids=List(solidCount){i->val at=32+surfaceCount*24+i*32;val owner=data.getInt(at+24);val flags=data.getInt(at+28)
                require(owner in owners.indices&&flags in 0..3)
                AnimalSolid("${owners[owner]}:$i",owners[owner],n(at),n(at+4),n(at+8),n(at+12),n(at+16),n(at+20),flags and 1!=0,flags and 2!=0)
                    .also{require(it.minX<it.maxX&&it.minY<it.maxY&&it.minZ<it.maxZ)}}
            return AnimalHabitatInput(java.util.Collections.unmodifiableList(surfaces),java.util.Collections.unmodifiableList(solids))
        }
    }
}

interface AnimalHabitatAccess {
    val world:AnimalCollisionWorld
    val bounds:AnimalBounds
    val landSeeds:List<AnimalPoint>
    val center:AnimalPoint
    fun waterAt(x:Double,z:Double):Double?
    fun flightFloor(x:Double,z:Double):Double
    fun swimClear(p:AnimalPoint):Boolean
    fun obstacleClear(p:AnimalPoint):Boolean
}
class NativeAnimalHabitat(input:AnimalHabitatInput,override val bounds:AnimalBounds,override val center:AnimalPoint,
                          override val landSeeds:List<AnimalPoint>):AnimalHabitatAccess {
    private val index=input.surfaceIndex
    // Source Habitat's structures arrive through the external ground callback,
    // which uses strict overlap rather than the navigator's indexed-solid EPS.
    // Preserve that boundary contract when moving them to native owner bins.
    override val world=AnimalCollisionWorld(bounds,ground={b->index.query(b).mapIndexed{i,s->
        AnimalSolid("ground:$i","ground",s.minX,s.maxX,-2048.0,s.top,s.minZ,s.maxZ,s.water)}},strictSourceOverlap=true)
    init{for((owner,solids)in input.solids.groupBy{it.owner})world.replaceOwner(owner,solids)}
    override fun waterAt(x:Double,z:Double):Double? {
        val near=index.query(AnimalBounds(x-.01,x+.01,z-.01,z+.01));var water=Double.NEGATIVE_INFINITY;var land=Double.NEGATIVE_INFINITY
        for(s in near)if(x>=s.minX&&x<=s.maxX&&z>=s.minZ&&z<=s.maxZ){if(s.water)water=max(water,s.top)else land=max(land,s.top)}
        return if(water.isFinite()&&land<water+.01)water else null
    }
    override fun flightFloor(x:Double,z:Double)=world.query(AnimalBounds(x-.3,x+.3,z-.3,z+.3)).fold(center.y){y,s->max(y,s.maxY)}
    override fun swimClear(p:AnimalPoint):Boolean {
        val water=waterAt(p.x,p.z)?:return false;if(p.y>water-.04||p.y<water-1.7)return false
        if(listOf(-.32 to -.32,.32 to .32,-.32 to .32,.32 to -.32).any{(dx,dz)->waterAt(p.x+dx,p.z+dz)==null})return false
        return obstacleClear(p)
    }
    override fun obstacleClear(p:AnimalPoint)=world.query(AnimalBounds(p.x-.25,p.x+.25,p.z-.25,p.z+.25)).none{!it.water&&it.maxY>p.y-.16&&it.minY<p.y+.16}
    fun groundIndexBytes()=index.byteSize
}
