package com.blockcolc.world

import com.blockcolc.world.generation.BlockTransform
import com.blockcolc.world.generation.CuboidGeometry
import com.blockcolc.world.generation.PaperFaceGeometry
import com.blockcolc.world.generation.TerrainMaterial
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.CancellationException

class NativeStaticWorldCodecTest {
    private val key = "a".repeat(64)

    private fun source(owner: String = "world"): NativePacketSource {
        val materials = NativeOriginalMaterials()
        val state = NativeSurfaceState(ambientOcclusion = .7f)
        val geometry = CuboidGeometry.create()
        val transform = FloatBuffer.wrap(FloatArray(16) { BlockTransform.IDENTITY[it].toFloat() })
        val water = materials.terrain(TerrainMaterial.WATER, state, coast = true)
        val glassBinding = NativeSurfaceBinding(.1f, .7f)
        val lantern = NativeRenderMaterial(environment = NativeMaterialBinding(glassBinding, .8f),
            surface = glassBinding.resolve(state))
        return NativePacketBuilder(owner, retainManifest = true).apply {
            add(geometry, water, transform, castShadow = false)
            add(geometry, lantern, transform, lod = SceneryLod("landmark", "full", Point3(1f, 2f, 3f), 4f))
            add(geometry, NativeRenderMaterial(vertexColors = true), transform)
        }.build()
    }

    private fun serialized(source: NativePacketSource): ByteBuffer {
        val buffers = checkNotNull(NativeStaticWorldCodec.encode(key, source) { false })
        assertTrue("Large owner data remains a separate read-only view", buffers.last().isReadOnly)
        return ByteBuffer.allocate(buffers.sumOf { it.remaining() }).apply {
            buffers.forEach { put(it.duplicate()) }
            flip()
        }
    }

    @Test fun staticRootRoundTripPreservesRenderAndPickInputs() {
        val before = source()
        val restored = checkNotNull(NativeStaticWorldCodec.decode(key, serialized(before)) { false })
        val expected = before.world!!
        val actual = restored.world!!
        assertEquals(expected.packedBytes(), actual.packedBytes())
        assertEquals(expected.packets, actual.packets)
        assertEquals(expected.materials, actual.materials)
        assertEquals(expected.geometries, actual.geometries)
        assertEquals(before.geometryKeys, restored.geometryKeys)
        assertEquals(before.bindings, restored.bindings)
        assertEquals(before.surfaces, restored.surfaces)
        assertEquals(before.textures.map { it.samplingIdentity }, restored.textures.map { it.samplingIdentity })
        assertEquals(before.footprint, restored.footprint)
    }

    @Test fun corruptTruncatedAndForeignEntriesCannotBeAdopted() {
        val bytes = serialized(source())
        assertNull(NativeStaticWorldCodec.decode("b".repeat(64), bytes) { false })
        assertNull(NativeStaticWorldCodec.decode(key, bytes.duplicate().apply { limit(limit() - 1) }) { false })
        val last = bytes.limit() - 1
        bytes.put(last, (bytes.get(last).toInt() xor 1).toByte())
        assertNull(NativeStaticWorldCodec.decode(key, bytes) { false })
        assertNull(NativeStaticWorldCodec.encode(key, source("building:example")) { false })
    }

    @Test fun compactPaperRootRoundTripsWithPackedColorAndPicking() {
        val vertices = ByteBuffer.allocateDirect(4 * PaperFaceGeometry.STRIDE).order(ByteOrder.LITTLE_ENDIAN)
        for ((x,z) in listOf(0f to 0f,1f to 0f,1f to 1f,0f to 1f)) {
            vertices.putFloat(x).putFloat(0f).putFloat(z).putInt(-1)
        }
        vertices.flip()
        val transform = FloatBuffer.wrap(FloatArray(16) { BlockTransform.IDENTITY[it].toFloat() })
        val source = NativePacketBuilder("world", retainManifest = true).apply {
            add(PaperFaceGeometry(vertices),NativeRenderMaterial(vertexColors=true,unlit=true,side=NativeFaceSide.DOUBLE),
                transform,castShadow=false,receiveShadow=false)
        }.build()
        val restored = checkNotNull(NativeStaticWorldCodec.decode(key,serialized(source)){false})
        val world = checkNotNull(restored.world)
        assertEquals(source.geometryKeys,restored.geometryKeys)
        assertEquals(4L*16+6*4,restored.footprint.geometryBytes)
        val pick=PickGeometry(world,world.geometries.single()){false}
        val ray=NativePickRay(com.blockcolc.world.generation.BlockPoint(.5,2.0,.5),
            com.blockcolc.world.generation.BlockPoint(0.0,-1.0,0.0))
        assertEquals(2.0,pick.hit(ray,2,10.0),1e-9)
    }

    @Test fun digestAndReadCooperateWithCancellation() {
        val before = source()
        assertThrows(CancellationException::class.java) { NativeStaticWorldCodec.encode(key, before) { true } }
        val bytes = serialized(before)
        assertThrows(CancellationException::class.java) { NativeStaticWorldCodec.decode(key, bytes) { true } }
    }
}
