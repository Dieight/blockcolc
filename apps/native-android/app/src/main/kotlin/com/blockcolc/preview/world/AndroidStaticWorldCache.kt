package com.blockcolc.preview.world

import android.content.Context
import com.blockcolc.domain.StrictJson
import com.blockcolc.preview.NativeStartupTrace
import com.blockcolc.world.NativePacketSource
import com.blockcolc.world.NativeStaticWorldCodec
import java.io.File
import java.nio.ByteBuffer

/** One optional packet entry per world-cache directory. APK replacement,
 * layout, generation inputs and baked lighting changes all invalidate it. */
internal class AndroidStaticWorldCache(context: Context, directory: File) : AutoCloseable {
    private val install = context.applicationInfo.sourceDir
    private val files = AndroidDerivedFile(context, directory, Format, mapReadOnly = true)
    internal val stats get() = files.stats

    fun key(world: WorldTerrainPlan, occlusion: Float): String = StrictJson.sha(
        listOf(install, world.input.spatial.key, world.cacheKey, world.sceneryKey, occlusion.toRawBits()).joinToString("\n")
    )

    fun read(key: String, cancelled: () -> Boolean) = files.read(key, cancelled)

    fun write(key: String, source: NativePacketSource) {
        files.scheduleWrite(key, source, delayMs = 1600) { NativeStartupTrace.point("root-packets-cache-written") }
    }

    override fun close() = files.close()
    internal fun awaitTermination(timeout:Long,unit:java.util.concurrent.TimeUnit) = files.awaitTermination(timeout,unit)

    private object Format : DerivedFileFormat<NativePacketSource> {
        override val kind = "static-world"
        override val fileName = "static-world-v1.bin"
        override val headerBytes = NativeStaticWorldCodec.HEADER_BYTES
        override val maximumBytes = NativeStaticWorldCodec.MAX_BYTES
        override fun isCandidate(key: String, header: ByteArray, length: Long) =
            NativeStaticWorldCodec.isCandidate(key, header, length)
        override fun encode(key: String, value: NativePacketSource, allocate: (Int) -> ByteBuffer, cancelled: () -> Boolean) =
            NativeStaticWorldCodec.encode(key, value, cancelled)
        override fun decode(key: String, bytes: ByteBuffer, cancelled: () -> Boolean) =
            NativeStaticWorldCodec.decode(key, bytes, cancelled)
    }
}
