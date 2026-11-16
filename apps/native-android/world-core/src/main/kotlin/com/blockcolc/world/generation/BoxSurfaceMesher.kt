package com.blockcolc.world.generation

import java.nio.FloatBuffer
import java.util.concurrent.CancellationException
import kotlin.math.*

data class BlockPoint(val x:Double,val y:Double,val z:Double) {
    operator fun get(axis:Int)=when(axis){0->x;1->y;2->z;else->throw IndexOutOfBoundsException()}
    init {require(x.isFinite()&&y.isFinite()&&z.isFinite())}
}

/** Local block coordinates are not confined to one cell: sign boards and
 * imported model elements can cross it. The owner transform remains separate. */
data class BlockBox(val min:BlockPoint,val max:BlockPoint) {
    init {require((0..2).all{min[it]<=max[it]})}
}

/** Flat normals and per-face UVs follow the accepted original-shape renderer.
 * Non-indexed triangles intentionally keep independently shaded face edges. */
class BoxSurfaceMesh internal constructor(private val positions:FloatArray,private val normals:FloatArray,private val texture:FloatArray,override val bounds:BlockBox?):BlockGeometry {
    override val vertexCount get()=positions.size/3
    override val byteSize get()=(positions.size+normals.size+texture.size)*4L
    override fun positions():FloatBuffer=FloatBuffer.wrap(positions).asReadOnlyBuffer()
    override fun normals():FloatBuffer=FloatBuffer.wrap(normals).asReadOnlyBuffer()
    override fun textureCoordinates():FloatBuffer=FloatBuffer.wrap(texture).asReadOnlyBuffer()
}

/** Tessellates the exposed union surface of arbitrary component cuboids. Cuts
 * are shared along all box planes, avoiding overlapping internal faces while
 * retaining the formal renderer's order, winding, flat normals and UV basis.
 * This prepares geometry only; it neither chooses a block model nor a tint. */
object BoxSurfaceMesher {
    const val MAX_BOXES=256
    const val MAX_VERTICES=1000000
    private class Floats {
        var size=0;private set
        private var values=FloatArray(1024)
        fun add(value:Double) {
            val narrowed=value.toFloat();require(narrowed.isFinite()){"Geometry cannot fit the GPU coordinate type"}
            if(size==values.size)values=values.copyOf(values.size*2)
            values[size++]=narrowed
        }
        fun freeze()=values.copyOf(size)
    }
    fun create(input:List<BlockBox>,maximumVertices:Int=MAX_VERTICES,cancelled:()->Boolean={false}):BoxSurfaceMesh {
        require(input.size<=MAX_BOXES);require(maximumVertices in 0..MAX_VERTICES)
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Block geometry superseded")}
        checkpoint();val boxes=input.toList()
        fun zero(value:Double)=if(value==0.0)0.0 else value
        val cuts=List(3){axis->boxes.flatMap{listOf(zero(it.min[axis]),zero(it.max[axis]))}.distinct().sorted()}
        val positions=Floats();val normals=Floats();val uv=Floats();var faces=0
        var lowX=Double.POSITIVE_INFINITY;var lowY=Double.POSITIVE_INFINITY;var lowZ=Double.POSITIVE_INFINITY
        var highX=Double.NEGATIVE_INFINITY;var highY=Double.NEGATIVE_INFINITY;var highZ=Double.NEGATIVE_INFINITY
        fun emit(axis:Int,sign:Int,firstAxis:Int,secondAxis:Int,p:DoubleArray) {
            for(a in 0..2){positions.add(p[a]);normals.add(if(a==axis)sign.toDouble()else 0.0)}
            uv.add(p[firstAxis]+.5);uv.add(p[secondAxis]+.5)
            // Three computes bounds from the final Float32 attribute, not from
            // the source Double boxes. Keep that upload contract here too.
            val x=p[0].toFloat().toDouble();val y=p[1].toFloat().toDouble();val z=p[2].toFloat().toDouble()
            lowX=min(lowX,x);lowY=min(lowY,y);lowZ=min(lowZ,z);highX=max(highX,x);highY=max(highY,y);highZ=max(highZ,z)
        }
        for((boxIndex,box)in boxes.withIndex()) {
            checkpoint()
            for(axis in 0..2) {
                val planeAxes=(0..2).filter{it!=axis};val firstAxis=planeAxes[0];val secondAxis=planeAxes[1]
                for(sign in listOf(-1,1)) {
                    val plane=if(sign<0)box.min[axis]else box.max[axis]
                    val firstCuts=listOf(box.min[firstAxis])+cuts[firstAxis].filter{it>box.min[firstAxis]&&it<box.max[firstAxis]}+box.max[firstAxis]
                    val secondCuts=listOf(box.min[secondAxis])+cuts[secondAxis].filter{it>box.min[secondAxis]&&it<box.max[secondAxis]}+box.max[secondAxis]
                    for(first in 0 until firstCuts.lastIndex)for(second in 0 until secondCuts.lastIndex) {
                        if(faces++%128==0)checkpoint()
                        val firstMin=firstCuts[first];val firstMax=firstCuts[first+1];val secondMin=secondCuts[second];val secondMax=secondCuts[second+1]
                        val firstMid=(firstMin+firstMax)/2;val secondMid=(secondMin+secondMax)/2
                        if(boxes.withIndex().any{(otherIndex,other)->
                            otherIndex!=boxIndex&&(if(sign<0)other.min[axis]<plane&&other.max[axis]>=plane else other.min[axis]<=plane&&other.max[axis]>plane)&&
                                firstMid>=other.min[firstAxis]&&firstMid<other.max[firstAxis]&&secondMid>=other.min[secondAxis]&&secondMid<other.max[secondAxis]
                        })continue
                        require(positions.size/3<=maximumVertices-6){"Block surface geometry exceeds vertex budget"}
                        fun point(a:Double,b:Double)=DoubleArray(3).also{it[axis]=plane;it[firstAxis]=a;it[secondAxis]=b}
                        val corners=arrayOf(point(firstMin,secondMin),point(firstMax,secondMin),point(firstMax,secondMax),point(firstMin,secondMax))
                        val a=DoubleArray(3){corners[1][it]-corners[0][it]};val b=DoubleArray(3){corners[2][it]-corners[0][it]}
                        val cross=when(axis){0->a[1]*b[2]-a[2]*b[1];1->a[2]*b[0]-a[0]*b[2];else->a[0]*b[1]-a[1]*b[0]}
                        val order=if(sign(cross)!=sign.toDouble())intArrayOf(0,3,2,0,2,1)else intArrayOf(0,1,2,0,2,3)
                        for(index in order)emit(axis,sign,firstAxis,secondAxis,corners[index])
                    }
                }
            }
        }
        checkpoint()
        val bounds=if(positions.size==0)null else BlockBox(BlockPoint(lowX,lowY,lowZ),BlockPoint(highX,highY,highZ))
        return BoxSurfaceMesh(positions.freeze(),normals.freeze(),uv.freeze(),bounds)
    }
}
