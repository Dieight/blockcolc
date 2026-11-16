package com.blockcolc.preview.world

import android.content.Context
import com.blockcolc.world.generation.SceneryCodec
import com.blockcolc.world.generation.WorldScenery
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit

class AndroidSceneryCache(context:Context,directory:File=File(context.cacheDir,"native-world"),maximumBytes:Int=SceneryCodec.MAX_BYTES):SceneryCachePort,AutoCloseable {
    private val files=AndroidDerivedFile(context,directory,Format,maximumBytes)
    val stats get()=files.stats
    override fun readScenery(key:String,cancelled:()->Boolean)=files.read(key,cancelled)
    override fun writeScenery(key:String,scene:WorldScenery)=files.write(key,scene)
    override fun close()=files.close()
    internal fun awaitWritesForTest(timeout:Long,unit:TimeUnit)=files.awaitWritesForTest(timeout,unit)
    internal fun awaitTermination(timeout:Long,unit:TimeUnit)=files.awaitTermination(timeout,unit)
    private object Format:DerivedFileFormat<WorldScenery> {
        override val kind="scenery";override val fileName="scenery-v1.bin"
        override val headerBytes=SceneryCodec.HEADER_BYTES;override val maximumBytes=SceneryCodec.MAX_BYTES
        override fun isCandidate(key:String,header:ByteArray,length:Long)=SceneryCodec.isCandidateHeader(key,header,length)
        override fun encode(key:String,value:WorldScenery,allocate:(Int)->ByteBuffer,cancelled:()->Boolean)=SceneryCodec.encodeBuffer(key,value,allocate,cancelled)
        override fun decode(key:String,bytes:ByteBuffer,cancelled:()->Boolean)=SceneryCodec.decodeBuffer(key,bytes,cancelled)
    }
}
