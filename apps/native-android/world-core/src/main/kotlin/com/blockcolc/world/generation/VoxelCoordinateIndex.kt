package com.blockcolc.world.generation

import java.util.concurrent.CancellationException

/** Lookup-only index borrowing one immutable voxel list. Integer slots replace
 * per-cell coordinate objects and HashMap nodes; duplicate coordinates keep
 * the last admitted source, including fractional coordinates and signed zero. */
internal class VoxelCoordinateIndex(
    private val voxels:List<RenderVoxel>,include:((RenderVoxel)->Boolean)?=null,cancelled:()->Boolean={false},
){
    private val slots:IntArray
    val storageBytes:Long get()=slots.size*4L
    init{
        fun check(index:Int){if(index%128==0&&(cancelled()||Thread.currentThread().isInterrupted))throw CancellationException("Voxel lookup superseded")}
        var count=0
        for(i in voxels.indices){check(i);if(include==null||include(voxels[i]))count++}
        var capacity=16
        while(capacity.toLong()<count*2L){require(capacity<=Int.MAX_VALUE/4){"Voxel lookup exceeds addressable input"};capacity*=2}
        slots=IntArray(capacity)
        for(i in voxels.indices){
            check(i);val v=voxels[i];if(include!=null&&!include(v))continue
            var slot=hash(v.x,v.y,v.z) and(slots.size-1)
            while(slots[slot]!=0&&!same(voxels[slots[slot]-1],v.x,v.y,v.z))slot=(slot+1)and(slots.size-1)
            slots[slot]=i+1
        }
    }
    operator fun get(x:Double,y:Double,z:Double):RenderVoxel? {
        var slot=hash(x,y,z)and(slots.size-1)
        while(true){val source=slots[slot];if(source==0)return null
            val voxel=voxels[source-1];if(same(voxel,x,y,z))return voxel
            slot=(slot+1)and(slots.size-1)
        }
    }
    companion object {
        private fun bits(value:Double)=if(value==0.0)0L else value.toBits()
        private fun same(v:RenderVoxel,x:Double,y:Double,z:Double)=bits(v.x)==bits(x)&&bits(v.y)==bits(y)&&bits(v.z)==bits(z)
        private fun hash(x:Double,y:Double,z:Double):Int {
            var h=bits(x)*-7046029254386353131L xor(bits(y)*-4658895280553007687L) xor(bits(z)*-7723592293110705685L)
            h=(h xor(h ushr 30))*-4658895280553007687L;h=(h xor(h ushr 27))*-7723592293110705685L
            h=h xor(h ushr 31);return(h xor(h ushr 32)).toInt()
        }
    }
}
