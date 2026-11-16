package com.blockcolc.world.generation

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.CancellationException

/** Disposable derived data only: no domain facts, imports, user strings, GPU
 * handles or timer state. Doubles preserve the exact CPU support datum. The
 * reader owns its input during decoding; returned arrays never alias it. */
object TerrainMeshCodec {
    const val MAX_BYTES=64*1024*1024
    private const val MAGIC=0x314e5442
    private const val FORMAT=1
    const val HEADER_BYTES=80
    private const val HEADER=HEADER_BYTES
    private const val BASE_BYTES=316
    private val keyPattern=Regex("[a-f0-9]{64}")
    private fun keyBytes(key:String):ByteArray {require(keyPattern.matches(key));return ByteArray(32){key.substring(it*2,it*2+2).toInt(16).toByte()}}
    /** Cheap rejection only, not body verification or authorization to adopt. */
    fun isCandidateHeader(expectedKey:String,header:ByteArray,totalBytes:Long):Boolean=try {
        require(header.size==HEADER&&totalBytes in BASE_BYTES.toLong()..MAX_BYTES.toLong())
        val input=ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
        require(input.int==MAGIC&&input.int==FORMAT&&input.int==SteppedTerrain.REVISION&&input.int.toLong()==totalBytes)
        ByteArray(32).also{input.get(it)}.contentEquals(keyBytes(expectedKey))
    }catch(_:Exception){false}
    private fun check(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Terrain cache superseded")}
    private fun digest(bytes:ByteBuffer,cancelled:()->Boolean):ByteArray {
        val digest=MessageDigest.getInstance("SHA-256");var offset=HEADER
        while(offset<bytes.limit()){check(cancelled);val count=minOf(65536,bytes.limit()-offset);digest.update(bytes.duplicate().apply{position(offset);limit(offset+count)});offset+=count}
        return digest.digest()
    }
    fun encode(key:String,mesh:TerrainMesh,cancelled:()->Boolean={false}):ByteArray? {
        var bytes:ByteArray?=null
        val result=encodeBuffer(key,mesh,{size->ByteArray(size).also{bytes=it}.let(ByteBuffer::wrap)},cancelled)
        return if(result==null)null else bytes
    }
    fun encodeBuffer(key:String,mesh:TerrainMesh,allocate:(Int)->ByteBuffer,cancelled:()->Boolean={false}):ByteBuffer? {
        val identity=keyBytes(key);check(cancelled)
        val positions=mesh.positions()
        val tops=TerrainMaterial.entries.map(mesh::topIndices)
        val sides=listOf(mesh.sideIndices(TerrainMaterial.DIRT),mesh.sideIndices(TerrainMaterial.STONE))
        val total=BASE_BYTES.toLong()+mesh.naturalTrees.size*32L+(if(mesh.oceanMain==null)0 else 16)+(mesh.oceanIslets?.size?:0)*32L+
            positions.remaining()*8L+(tops+sides).sumOf{it.remaining().toLong()}*4L
        if(total>MAX_BYTES||mesh.naturalTrees.size>20000||(mesh.oceanIslets?.size?:0)>128)return null
        val out=allocate(total.toInt()).order(ByteOrder.LITTLE_ENDIAN)
        require(!out.isReadOnly&&out.position()==0&&out.remaining()==total.toInt())
        out.putInt(MAGIC).putInt(FORMAT).putInt(SteppedTerrain.REVISION).putInt(total.toInt()).put(identity).put(ByteArray(32))
        out.putInt(mesh.cellCount)
        val b=mesh.bounds
        for(value in doubleArrayOf(b.minX,b.maxX,b.minY,b.maxY,b.minZ,b.maxZ))out.putDouble(value)
        for(p in listOf(mesh.framingBounds,mesh.nearDetailBounds))for(value in doubleArrayOf(p.minX,p.maxX,p.minZ,p.maxZ))out.putDouble(value)
        out.putInt(mesh.lod.near).putInt(mesh.lod.middle).putInt(mesh.lod.far)
        val h=mesh.hydrology
        for(value in intArrayOf(h.networks,h.basins,h.rivers,h.lakes,h.segments,h.outlets,h.protectedCells))out.putInt(value)
        out.putDouble(h.maxUphill).putDouble(h.waterArea).putDouble(h.terrainArea)
        out.putInt(mesh.naturalTrees.size)
        for(tree in mesh.naturalTrees)out.putDouble(tree.x).putDouble(tree.y).putDouble(tree.z).putDouble(tree.scale)
        out.putInt(if(mesh.oceanMain==null)0 else 1);mesh.oceanMain?.let{out.putDouble(it.radius).putDouble(it.beach)}
        out.putInt(mesh.oceanIslets?.size?: -1)
        for(islet in mesh.oceanIslets.orEmpty())out.putDouble(islet.x).putDouble(islet.z).putDouble(islet.radius).putDouble(islet.peakHeight)
        out.putInt(positions.remaining());for(indices in tops+sides)out.putInt(indices.remaining())
        var n=0
        while(positions.hasRemaining()){if(n++%4096==0)check(cancelled);out.putDouble(positions.get())}
        for(indices in tops+sides)while(indices.hasRemaining()){if(n++%4096==0)check(cancelled);out.putInt(indices.get())}
        kotlin.check(out.position()==total.toInt())
        val hash=digest(out,cancelled);out.position(48);out.put(hash);out.position(0)
        check(cancelled);return out.asReadOnlyBuffer()
    }
    fun decode(expectedKey:String,bytes:ByteArray,cancelled:()->Boolean={false}):TerrainMesh?=decodeBuffer(expectedKey,ByteBuffer.wrap(bytes),cancelled)
    fun decodeBuffer(expectedKey:String,bytes:ByteBuffer,cancelled:()->Boolean={false}):TerrainMesh? {
        try {
            val key=keyBytes(expectedKey);check(cancelled)
            require(bytes.remaining() in BASE_BYTES..MAX_BYTES)
            val input=bytes.slice().order(ByteOrder.LITTLE_ENDIAN)
            require(input.int==MAGIC&&input.int==FORMAT&&input.int==SteppedTerrain.REVISION&&input.int==input.limit())
            val actualKey=ByteArray(32).also{input.get(it)};require(actualKey.contentEquals(key))
            val expectedDigest=ByteArray(32).also{input.get(it)};require(MessageDigest.isEqual(expectedDigest,digest(input,cancelled)))
            fun integer(maximum:Int=Int.MAX_VALUE)=input.int.also{require(it in 0..maximum)}
            fun number()=input.double.also{require(it.isFinite())}
            fun planBounds()=TerrainPlanBounds(number(),number(),number(),number()).also{require(it.minX<=it.maxX&&it.minZ<=it.maxZ)}
            val cellCount=integer()
            val bounds=TerrainBounds(number(),number(),number(),number(),number(),number()).also{require(it.minX<=it.maxX&&it.minY<=it.maxY&&it.minZ<=it.maxZ)}
            val framing=planBounds();val near=planBounds();val lod=TerrainLodCounts(integer(),integer(),integer())
            require(lod.near.toLong()+lod.middle+lod.far==cellCount.toLong())
            val networks=integer();val basins=integer();val rivers=integer(cellCount);val lakes=integer(cellCount);val segments=integer();val outlets=integer();val protected=integer(cellCount)
            val uphill=number();val waterArea=number();val terrainArea=number()
            require(uphill>=0&&waterArea>=0&&terrainArea>=waterArea)
            val water=TerrainWaterStats(networks,basins,rivers,lakes,segments,outlets,uphill,protected,waterArea,terrainArea)
            val treeCount=integer(20000);require(treeCount*32L<=input.remaining())
            val trees=List(treeCount){index->if(index%256==0)check(cancelled);TerrainTree(number(),number(),number(),number()).also{require(it.scale>0)}}
            val mainFlag=integer(1)
            val main=if(mainFlag==0)null else OceanMain(number(),number()).also{require(it.radius>0&&it.beach>0)}
            val isletCount=input.int;require(isletCount in -1..128&&maxOf(0,isletCount)*32L<=input.remaining())
            val islets=if(isletCount<0)null else List(isletCount){OceanIslet(number(),number(),number(),number()).also{require(it.radius>0&&it.peakHeight>0)}}
            val coordinateCount=integer(6000000);require(coordinateCount%3==0)
            val counts=IntArray(10){integer(6000000)}
            require(counts.take(8).all{it%6==0}&&counts.drop(8).all{it%3==0})
            require(counts.take(8).sumOf{it.toLong()}/6==cellCount.toLong())
            require(coordinateCount*8L+counts.sumOf{it.toLong()}*4==input.remaining().toLong())
            val coordinates=DoubleArray(coordinateCount){index->if(index%4096==0)check(cancelled);number()}
            val vertexCount=coordinateCount/3
            val buffers=Array(10){index->IntArray(counts[index]){offset->if(offset%4096==0)check(cancelled);integer(vertexCount-1)}}
            // Samplers consume ordered flat rectangles, not arbitrary triangle
            // soup. Validate this before a restored cache reaches the sampler.
            for(indices in buffers.take(8))for(offset in indices.indices step 6) {
                if(offset%4096==0)check(cancelled)
                require(indices[offset]==indices[offset+3]&&indices[offset+2]==indices[offset+4])
                val a=indices[offset]*3;val b=indices[offset+1]*3;val c=indices[offset+2]*3;val d=indices[offset+5]*3
                require(coordinates[a]<coordinates[c]&&coordinates[a+2]<coordinates[b+2])
                require(coordinates[a]==coordinates[b]&&coordinates[c]==coordinates[d]&&coordinates[a+2]==coordinates[d+2]&&coordinates[b+2]==coordinates[c+2])
                require(coordinates[a+1]==coordinates[b+1]&&coordinates[a+1]==coordinates[c+1]&&coordinates[a+1]==coordinates[d+1])
            }
            require(!input.hasRemaining());check(cancelled)
            return TerrainMesh(coordinates,buffers.take(8).toTypedArray(),buffers.drop(8).toTypedArray(),cellCount,bounds,framing,near,trees,lod,water,islets,main)
        }catch(error:CancellationException){throw error}
        catch(_:Exception){return null}
    }
}
