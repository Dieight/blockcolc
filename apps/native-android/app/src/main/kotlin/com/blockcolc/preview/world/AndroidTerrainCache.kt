package com.blockcolc.preview.world

import android.content.Context
import com.blockcolc.world.generation.TerrainMesh
import com.blockcolc.world.generation.TerrainMeshCodec
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit

class AndroidTerrainCache(context:Context,directory:File=File(context.cacheDir,"native-world"),maximumBytes:Int=TerrainMeshCodec.MAX_BYTES):TerrainCachePort,AutoCloseable {
    private val files=AndroidDerivedFile(context,directory,Format,maximumBytes)
    val stats get()=files.stats
    override fun read(key:String,cancelled:()->Boolean)=files.read(key,cancelled)
    override fun write(key:String,mesh:TerrainMesh)=files.write(key,mesh)
    override fun close()=files.close()
    internal fun awaitWritesForTest(timeout:Long,unit:TimeUnit)=files.awaitWritesForTest(timeout,unit)
    internal fun awaitTermination(timeout:Long,unit:TimeUnit)=files.awaitTermination(timeout,unit)
    private object Format:DerivedFileFormat<TerrainMesh> {
        override val kind="terrain";override val fileName="terrain-v1.bin"
        override val headerBytes=TerrainMeshCodec.HEADER_BYTES;override val maximumBytes=TerrainMeshCodec.MAX_BYTES
        override fun isCandidate(key:String,header:ByteArray,length:Long)=TerrainMeshCodec.isCandidateHeader(key,header,length)
        override fun encode(key:String,value:TerrainMesh,allocate:(Int)->ByteBuffer,cancelled:()->Boolean)=TerrainMeshCodec.encodeBuffer(key,value,allocate,cancelled)?.let{listOf(it)}
        override fun decode(key:String,bytes:ByteBuffer,cancelled:()->Boolean)=TerrainMeshCodec.decodeBuffer(key,bytes,cancelled)
    }
}
