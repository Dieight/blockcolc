package com.blockcolc.world.generation

import java.nio.DoubleBuffer
import java.nio.IntBuffer
import java.nio.FloatBuffer
import com.blockcolc.world.NativePacketBuffers
import java.util.Collections
import java.util.concurrent.CancellationException
import kotlin.math.sqrt

/** Adopts the generated quad mesh, not a baked scene. UVs retain the original
 * world scale; normals are accumulated from the actual Float32 positions, as
 * at the source upload boundary. Unused vertices are removed per draw group. */
object NativePlanarGeometry {
    /** These buffers are written only by this compiler. Android may map large
     * payloads outside ART, including temporary normal/remap workspaces. Fresh
     * read-only views retain ownership without exposing a mutable cursor. */
    private class Geometry(private val p:FloatBuffer,private val n:FloatBuffer,private val uv:FloatBuffer,private val ix:IntBuffer,
        override val bounds:BlockBox):BlockGeometry {
        override val vertexCount=p.limit()/3
        override val byteSize=(p.limit()+n.limit()+uv.limit()+ix.limit())*4L
        override fun positions()=p.asReadOnlyBuffer()
        override fun normals()=n.asReadOnlyBuffer()
        override fun textureCoordinates()=uv.asReadOnlyBuffer()
        override fun indices()=ix.asReadOnlyBuffer()
    }
    fun groups(input:DoubleBuffer,groups:List<IntBuffer>,unitsPerTile:Double=4.0,cancelled:()->Boolean={false}):List<BlockGeometry?> {
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Planar geometry superseded")}
        checkpoint();require(input.remaining()%12==0&&input.remaining()<=12_000_000&&unitsPerTile.isFinite()&&unitsPerTile>0)
        val source=input.duplicate();val base=source.position();val count=source.remaining()/3
        fun original(index:Int)=source.get(base+index)
        // Borrow the immutable source doubles for UVs; keep only the narrowed
        // positions needed for source-identical normal accumulation.
        val positions=NativePacketBuffers.floats(source.remaining())
        for(i in 0 until positions.limit()){
            if(i%3072==0)checkpoint()
            positions.put(i,original(i).also{v->require(v.isFinite())}.toFloat().also{v->require(v.isFinite())})
        }
        val normal=NativePacketBuffers.floats(positions.limit());val uv=NativePacketBuffers.floats(count*2)
        for(i in 0 until normal.limit())normal.put(i,0f)
        var q=0
        while(q<count){if(q%1024==0)checkpoint()
            var flat=0;var smallest=Double.POSITIVE_INFINITY
            for(axis in 0..2){var low=Double.POSITIVE_INFINITY;var high=Double.NEGATIVE_INFINITY
                repeat(4){v->val value=original((q+v)*3+axis);low=minOf(low,value);high=maxOf(high,value)}
                if(high-low<smallest){smallest=high-low;flat=axis}}
            repeat(4){v->val at=(q+v)*3;uv.put((q+v)*2,(original(at+if(flat==0)2 else 0)/unitsPerTile).toFloat())
                uv.put((q+v)*2+1,(original(at+if(flat==1)2 else 1)/unitsPerTile).toFloat())};q+=4
        }
        for(raw in groups){val indices=raw.duplicate();require(indices.remaining()%3==0)
            while(indices.hasRemaining()){if(indices.position()%3072==0)checkpoint();val a=indices.get();val b=indices.get();val c=indices.get()
                require(a in 0 until count&&b in 0 until count&&c in 0 until count)
                val ai=a*3;val bi=b*3;val ci=c*3
                val bx=positions[bi];val by=positions[bi+1];val bz=positions[bi+2]
                val cbx=positions[ci].toDouble()-bx;val cby=positions[ci+1].toDouble()-by;val cbz=positions[ci+2].toDouble()-bz
                val abx=positions[ai].toDouble()-bx;val aby=positions[ai+1].toDouble()-by;val abz=positions[ai+2].toDouble()-bz
                val nx=cby*abz-cbz*aby;val ny=cbz*abx-cbx*abz;val nz=cbx*aby-cby*abx
                for(slot in 0..2){val at=when(slot){0->a;1->b;else->c}*3
                    normal.put(at,(normal[at]+nx).toFloat());normal.put(at+1,(normal[at+1]+ny).toFloat());normal.put(at+2,(normal[at+2]+nz).toFloat())}
            }
        }
        for(vertex in 0 until count){
            if(vertex%1024==0)checkpoint()
            val at=vertex*3;val nx=normal[at].toDouble();val ny=normal[at+1].toDouble();val nz=normal[at+2].toDouble()
            val length=sqrt(nx*nx+ny*ny+nz*nz)
            if(length>0){normal.put(at,(nx/length).toFloat());normal.put(at+1,(ny/length).toFloat());normal.put(at+2,(nz/length).toFloat())}
        }
        // Stable first-reference order, with eight bytes per source vertex
        // rather than a HashMap node, two boxed Ints and a boxed order list.
        val remap=NativePacketBuffers.ints(count);val order=NativePacketBuffers.ints(count)
        for(i in 0 until count)remap.put(i,0)
        return Collections.unmodifiableList(groups.map{raw->
            checkpoint();if(!raw.hasRemaining())null else {
                val indices=raw.duplicate();var used=0;val target=NativePacketBuffers.ints(indices.remaining())
                for(i in 0 until target.limit()){if(i%3072==0)checkpoint();val old=indices.get();var mapped=remap[old]
                    if(mapped==0){order.put(used,old);mapped=++used;remap.put(old,mapped)};target.put(i,mapped-1)}
                val p=NativePacketBuffers.floats(used*3);val n=NativePacketBuffers.floats(used*3);val tex=NativePacketBuffers.floats(used*2)
                val low=DoubleArray(3){Double.POSITIVE_INFINITY};val high=DoubleArray(3){Double.NEGATIVE_INFINITY}
                // Read the source index once per vertex. Validate and compute
                // bounds while transferring, rather than rereading the new buffers.
                for(i in 0 until used){
                    if(i%1024==0)checkpoint()
                    val old=order[i];val from=old*3;val to=i*3
                    for(axis in 0..2){
                        val value=positions[from+axis];val direction=normal[from+axis]
                        require(direction.isFinite())
                        p.put(to+axis,value);n.put(to+axis,direction)
                        low[axis]=minOf(low[axis],value.toDouble());high[axis]=maxOf(high[axis],value.toDouble())
                    }
                    val u=uv[old*2];val v=uv[old*2+1];require(u.isFinite()&&v.isFinite())
                    tex.put(i*2,u);tex.put(i*2+1,v);remap.put(old,0)
                }
                Geometry(p,n,tex,target,BlockBox(BlockPoint(low[0],low[1],low[2]),BlockPoint(high[0],high[1],high[2])))
            }
        }).also{checkpoint()}
    }
    fun terrain(input:TerrainMesh,cancelled:()->Boolean={false}):List<BlockGeometry?> = groups(input.positions(),
        TerrainMaterial.entries.map{input.topIndices(it)}+listOf(input.sideIndices(TerrainMaterial.DIRT),input.sideIndices(TerrainMaterial.STONE)),cancelled=cancelled)
    fun roads(input:RoadGeometry,cancelled:()->Boolean={false}):BlockGeometry?=groups(input.positions(),listOf(input.indices()),cancelled=cancelled).single()
}
