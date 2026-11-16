package com.blockcolc.world.generation

import java.nio.DoubleBuffer
import kotlin.math.*

/** Immutable column-major local transform. State orientation belongs to the
 * instance; canonical component geometry can then be shared across facings. */
class BlockTransform private constructor(private val values:DoubleArray) {
    operator fun get(index:Int)=values[index]
    fun elements():DoubleBuffer=DoubleBuffer.wrap(values).asReadOnlyBuffer()
    fun withPosition(x:Double,y:Double,z:Double):BlockTransform {
        require(x.isFinite()&&y.isFinite()&&z.isFinite())
        return BlockTransform(values.copyOf().also{it[12]=x;it[13]=y;it[14]=z})
    }
    operator fun times(other:BlockTransform):BlockTransform {
        val result=DoubleArray(16)
        for(column in 0..3)for(row in 0..3)result[column*4+row]=
            values[row]*other[column*4]+values[4+row]*other[column*4+1]+values[8+row]*other[column*4+2]+values[12+row]*other[column*4+3]
        return BlockTransform(result)
    }
    fun point(p:BlockPoint):BlockPoint {
        val x=p.x;val y=p.y;val z=p.z;val w=1/(values[3]*x+values[7]*y+values[11]*z+values[15])
        return BlockPoint((values[0]*x+values[4]*y+values[8]*z+values[12])*w,(values[1]*x+values[5]*y+values[9]*z+values[13])*w,(values[2]*x+values[6]*y+values[10]*z+values[14])*w)
    }
    fun box(box:BlockBox):BlockBox {
        var minX=Double.POSITIVE_INFINITY;var minY=minX;var minZ=minX
        var maxX=Double.NEGATIVE_INFINITY;var maxY=maxX;var maxZ=maxX
        // Preserve the corner oracle and arithmetic order used by point(),
        // including reflected/sheared transforms. Avoid creating lists and
        // temporary points for every rendered instance.
        for(mask in 0..7){
            val x=if(mask and 4==0)box.min.x else box.max.x
            val y=if(mask and 2==0)box.min.y else box.max.y
            val z=if(mask and 1==0)box.min.z else box.max.z
            val w=1/(values[3]*x+values[7]*y+values[11]*z+values[15])
            val px=(values[0]*x+values[4]*y+values[8]*z+values[12])*w
            val py=(values[1]*x+values[5]*y+values[9]*z+values[13])*w
            val pz=(values[2]*x+values[6]*y+values[10]*z+values[14])*w
            minX=min(minX,px);minY=min(minY,py);minZ=min(minZ,pz)
            maxX=max(maxX,px);maxY=max(maxY,py);maxZ=max(maxZ,pz)
        }
        return BlockBox(BlockPoint(minX,minY,minZ),BlockPoint(maxX,maxY,maxZ))
    }
    companion object {
        fun fromElements(input:DoubleArray):BlockTransform {
            require(input.size==16&&input.all{it.isFinite()}&&input[3]==0.0&&input[7]==0.0&&input[11]==0.0&&input[15]==1.0)
            return BlockTransform(input.copyOf())
        }
        val IDENTITY=BlockTransform(doubleArrayOf(1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0))
        fun rotationY(angle:Double):BlockTransform {
            require(angle.isFinite());val c=cos(angle);val s=sin(angle)
            return BlockTransform(doubleArrayOf(c,0.0,-s,0.0,0.0,1.0,0.0,0.0,s,0.0,c,0.0,0.0,0.0,0.0,1.0))
        }
        fun rotationX(angle:Double):BlockTransform {
            require(angle.isFinite());val c=cos(angle);val s=sin(angle)
            return BlockTransform(doubleArrayOf(1.0,0.0,0.0,0.0,0.0,c,s,0.0,0.0,-s,c,0.0,0.0,0.0,0.0,1.0))
        }
        fun rotationZ(angle:Double):BlockTransform {
            require(angle.isFinite());val c=cos(angle);val s=sin(angle)
            return BlockTransform(doubleArrayOf(c,s,0.0,0.0,-s,c,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0))
        }
        fun translation(x:Double,y:Double,z:Double):BlockTransform {
            require(x.isFinite()&&y.isFinite()&&z.isFinite());return BlockTransform(IDENTITY.values.copyOf().also{it[12]=x;it[13]=y;it[14]=z})
        }
    }
}
