package com.blockcolc.world

import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.CancellationException

/** Only the original terrain and scenery owner. The usual packet reader checks
 * geometry and instances after the envelope digest. Environmental bindings are
 * reapplied to the current scene and no engine objects cross this boundary. */
object NativeStaticWorldCodec {
    const val HEADER_BYTES = 80
    const val MAX_BYTES = 96 * 1024 * 1024
    private const val MAGIC = 0x31525742
    private const val MAX_METADATA_BYTES = 4 * 1024 * 1024
    private val surfaceState = NativeSurfaceState()
    private val unbound = SurfaceCoverage(SurfaceEffects.NONE, emptyList(), emptyList())

    private fun checkpoint(cancelled: () -> Boolean) {
        if (cancelled() || Thread.currentThread().isInterrupted) throw CancellationException("Static world cache superseded")
    }

    private fun keyBytes(key: String): ByteArray {
        require(key.matches(Regex("[a-f0-9]{64}")))
        return ByteArray(32) { key.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }

    private fun digest(parts: List<ByteBuffer>, cancelled: () -> Boolean): ByteArray {
        val sha = MessageDigest.getInstance("SHA-256")
        for (part in parts) {
            val view = part.duplicate()
            val end = view.limit()
            while (view.hasRemaining()) {
                checkpoint(cancelled)
                view.limit(minOf(end, view.position() + 256 * 1024))
                sha.update(view)
                view.limit(end)
            }
        }
        return sha.digest()
    }

    fun isCandidate(key: String, header: ByteArray, size: Long): Boolean {
        if (header.size != HEADER_BYTES || size !in HEADER_BYTES.toLong()..MAX_BYTES.toLong()) return false
        val b = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
        if (b.int != MAGIC || b.int.toLong() != size) return false
        val manifestBytes = b.int
        val metadataBytes = b.int
        return manifestBytes in 1..MAX_METADATA_BYTES && metadataBytes in 1..MAX_METADATA_BYTES &&
            HEADER_BYTES + manifestBytes.toLong() + metadataBytes + 16 <= size &&
            MessageDigest.isEqual(ByteArray(32).also(b::get), keyBytes(key))
    }

    /** Write the large immutable payload directly instead of allocating a second copy. */
    fun encode(key: String, source: NativePacketSource, cancelled: () -> Boolean): List<ByteBuffer>? {
        checkpoint(cancelled)
        if (source.owner != "world" || source.layer != NativePacketLayer.STATIC || source.atlasSchedules.isNotEmpty()) return null
        val world = source.world ?: return null
        val manifest = world.retainedManifest?.toByteArray(Charsets.UTF_8) ?: return null
        if (manifest.size !in 1..MAX_METADATA_BYTES || world.byteSize >= MAX_BYTES) return null
        if (source.textures.any { it.manualMipmaps.isNotEmpty() || it.dynamicIdentity != null }) return null
        val bindings = JSONArray()
        for ((index, binding) in source.bindings.withIndex()) {
            checkpoint(cancelled)
            if (binding?.cloud == true || binding?.sky != null ||
                source.surfaces[index] != (binding?.surface?.resolve(surfaceState) ?: unbound)) return null
            val material = JSONObject()
            binding?.surface?.let { surface ->
                material.put("surface", JSONArray(listOf(surface.edge.toDouble(), surface.gain.toDouble(), surface.fluid,
                    surface.weatherWater, surface.distanceOpacity)))
            }
            binding?.nightEmissionMaximum?.let { material.put("emission", it.toDouble()) }
            bindings.put(material)
        }
        val metadata = JSONObject().put("textures", source.textureMetadata()).put("bindings", bindings)
            .toString().toByteArray(Charsets.UTF_8)
        if (metadata.size !in 1..MAX_METADATA_BYTES) return null
        val body = listOf(ByteBuffer.wrap(manifest), ByteBuffer.wrap(metadata)) + source.textures.map { it.pixels() } + world.packedBytes()
        val total = HEADER_BYTES + body.sumOf { it.remaining().toLong() }
        if (total > MAX_BYTES) return null
        val header = ByteBuffer.allocate(HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN)
        header.putInt(MAGIC).putInt(total.toInt()).putInt(manifest.size).putInt(metadata.size)
            .put(keyBytes(key)).put(digest(body, cancelled)).flip()
        return listOf(header.asReadOnlyBuffer()) + body
    }

    fun decode(key: String, input: ByteBuffer, cancelled: () -> Boolean): NativePacketSource? {
        checkpoint(cancelled)
        if (input.remaining() !in HEADER_BYTES..MAX_BYTES) return null
        val b = input.slice().order(ByteOrder.LITTLE_ENDIAN)
        val header = ByteArray(HEADER_BYTES).also(b::get)
        if (!isCandidate(key, header, input.remaining().toLong()) ||
            !MessageDigest.isEqual(digest(listOf(b), cancelled), header.copyOfRange(HEADER_BYTES - 32, HEADER_BYTES))) return null
        val sizes = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
        fun text(length: Int): String = ByteArray(length).also(b::get).toString(Charsets.UTF_8)
        val manifest = text(sizes.getInt(8))
        val metadata = JSONObject(text(sizes.getInt(12)))
        val textureRows = metadata.getJSONArray("textures")
        require(textureRows.length() <= 4096)
        val textures = List(textureRows.length()) { index ->
            checkpoint(cancelled)
            val row = textureRows.getJSONObject(index)
            require(row.getInt("id") == index && row.getString("encoding") == "rgba8")
            val width = row.getInt("width")
            val height = row.getInt("height")
            require(width in 1..8192 && height in 1..8192 && width * height <= 32 * 1024 * 1024)
            val length = width * height * 4
            require(length <= b.remaining() - 16)
            val pixels = b.slice().apply { limit(length) }
            b.position(b.position() + length)
            NativePixelTexture(width, height, pixels, srgb = row.getString("colorSpace") == "srgb",
                mipmaps = row.getBoolean("generateMipmaps"), wrapS = row.getInt("wrapS"), wrapT = row.getInt("wrapT"),
                minFilter = row.getInt("minFilter"), magFilter = row.getInt("magFilter"), anisotropy = row.getDouble("anisotropy").toFloat())
                .also { require(it.sha256 == row.getString("image")) }
        }
        val world = WorldPackets.read(manifest, b, cancelled = cancelled)
        require(world.packets.all { it.owner == "world" && it.layer == "static" } && world.geometries.all { it.vertexPreparation == null || it.paper })
        val rows = metadata.getJSONArray("bindings")
        require(rows.length() == world.materials.size)
        val bindings = List(rows.length()) { index ->
            val material = JSONObject(world.materials[index])
            require(material.isNull("texture") || material.getInt("texture") in textures.indices)
            val row = rows.getJSONObject(index)
            val surface = row.optJSONArray("surface")?.let {
                require(it.length() == 5)
                NativeSurfaceBinding(it.getDouble(0).toFloat(), it.getDouble(1).toFloat(), it.getBoolean(2), it.getBoolean(3), it.getBoolean(4))
            }
            val emission = if (row.has("emission")) row.getDouble("emission").toFloat() else null
            if (surface == null && emission == null) null else NativeMaterialBinding(surface, emission)
        }
        checkpoint(cancelled)
        return NativePacketSource("world", world, textures, bindings.map { it?.surface?.resolve(surfaceState) ?: unbound }, bindings)
    }
}
