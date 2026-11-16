package com.blockcolc.world.generation

import java.nio.FloatBuffer
import java.nio.IntBuffer

internal class FloatAttributeBuilder(private val maximum:Int) {
    private var values=FloatArray(minOf(256,maximum));var size=0;private set
    fun add(value:Double) {
        require(size<maximum){"Geometry exceeds attribute budget"};val v=value.toFloat();require(v.isFinite())
        if(size==values.size)values=values.copyOf(minOf(maximum,maxOf(1,values.size)*2));values[size++]=v
    }
    fun freeze()=values.copyOf(size)
}
internal class IndexAttributeBuilder(private val maximum:Int) {
    private var values=IntArray(minOf(256,maximum));var size=0;private set
    fun add(value:Int) {
        require(size<maximum){"Geometry exceeds index budget"}
        if(size==values.size)values=values.copyOf(minOf(maximum,maxOf(1,values.size)*2));values[size++]=value
    }
    fun freeze()=values.copyOf(size)
}

/** Engine-independent upload attributes. Views are fresh and read-only; GPU
 * objects and material lifetimes never belong to a generation result. */
interface BlockGeometry {
    val vertexCount:Int
    val byteSize:Long
    val bounds:BlockBox?
    fun positions():FloatBuffer
    fun normals():FloatBuffer
    fun textureCoordinates():FloatBuffer?
    fun colors():FloatBuffer?=null
    fun colorAlpha():FloatBuffer?=null
    val vertexPreparation:String? get()=null
    fun indices():IntBuffer?=null
}

internal class AttributeBlockGeometry(private val position:FloatArray,private val normal:FloatArray,private val texture:FloatArray?=null,
    private val color:FloatArray?=null,private val index:IntArray?=null):BlockGeometry {
    init {
        require(position.size%3==0&&normal.size==position.size)
        require(texture==null||texture.size==position.size/3*2)
        require(color==null||color.size==position.size)
        require(listOfNotNull(position,normal,texture,color).all{a->a.all{it.isFinite()}})
        require(index==null||index.size%3==0&&index.all{it in 0 until position.size/3})
    }
    override val vertexCount get()=position.size/3
    override val byteSize get()=(position.size+normal.size+(texture?.size?:0)+(color?.size?:0)+(index?.size?:0))*4L
    override val bounds:BlockBox? = if(position.isEmpty())null else {
        val lo=DoubleArray(3){Double.POSITIVE_INFINITY};val hi=DoubleArray(3){Double.NEGATIVE_INFINITY}
        for(i in position.indices){val a=i%3;lo[a]=kotlin.math.min(lo[a],position[i].toDouble());hi[a]=kotlin.math.max(hi[a],position[i].toDouble())}
        BlockBox(BlockPoint(lo[0],lo[1],lo[2]),BlockPoint(hi[0],hi[1],hi[2]))
    }
    override fun positions():FloatBuffer=FloatBuffer.wrap(position).asReadOnlyBuffer()
    override fun normals():FloatBuffer=FloatBuffer.wrap(normal).asReadOnlyBuffer()
    override fun textureCoordinates():FloatBuffer?=texture?.let{FloatBuffer.wrap(it).asReadOnlyBuffer()}
    override fun colors():FloatBuffer?=color?.let{FloatBuffer.wrap(it).asReadOnlyBuffer()}
    override fun indices():IntBuffer?=index?.let{IntBuffer.wrap(it).asReadOnlyBuffer()}
}

/** One-segment cuboid layout adapted from Three.js BoxGeometry (MIT). Retain
 * its face order, UVs and Float32 narrowing before subsequent transforms; the
 * exposed-union box mesher has intentionally different UVs. */
object CuboidGeometry {
    fun create(width:Double=1.0,height:Double=1.0,depth:Double=1.0):BlockGeometry {
        require(listOf(width,height,depth).all{it.isFinite()&&it>=0})
        val positions=FloatArray(108);val normals=FloatArray(108);val uv=FloatArray(72);var face=0
        fun plane(u:Int,v:Int,w:Int,udir:Int,vdir:Int,across:Double,tall:Double,out:Double) {
            val coordinates=Array(4){FloatArray(3)}
            for(iy in 0..1)for(ix in 0..1){val p=coordinates[ix+iy*2];p[u]=((ix*across-across/2)*udir).toFloat();p[v]=((iy*tall-tall/2)*vdir).toFloat();p[w]=(out/2).toFloat()}
            val order=intArrayOf(0,2,1,2,3,1)
            for((vertex,corner)in order.withIndex()) {
                val offset=(face*6+vertex)*3
                for(axis in 0..2){positions[offset+axis]=coordinates[corner][axis];normals[offset+axis]=if(axis==w)if(out>0)1f else -1f else 0f}
                val at=(face*6+vertex)*2;uv[at]=(corner%2).toFloat();uv[at+1]=(1-corner/2).toFloat()
            };face++
        }
        plane(2,1,0,-1,-1,depth,height,width);plane(2,1,0,1,-1,depth,height,-width)
        plane(0,2,1,1,1,width,depth,height);plane(0,2,1,1,-1,width,depth,-height)
        plane(0,1,2,1,-1,width,height,depth);plane(0,1,2,-1,-1,width,height,-depth)
        return AttributeBlockGeometry(positions,normals,uv)
    }
}
