package com.blockcolc.preview.world

import com.blockcolc.world.LinearRgb
import com.blockcolc.world.NativePacketAllocator
import com.blockcolc.world.NativePacketBuilder
import com.blockcolc.world.NativeFaceSide
import com.blockcolc.world.NativeRenderMaterial
import com.blockcolc.world.NativeStructurePlacement
import com.blockcolc.world.generation.BlockPoint
import com.blockcolc.world.generation.BlockTransform
import com.blockcolc.world.generation.OriginalMaterialStyles
import com.blockcolc.world.generation.PaperFaceGeometry
import com.blockcolc.world.generation.RenderVoxel
import com.blockcolc.world.generation.TerrainMaterial
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.DoubleBuffer
import java.nio.FloatBuffer
import java.nio.IntBuffer
import java.util.concurrent.CancellationException
import kotlin.math.abs
import kotlin.math.roundToInt

/** Flat pigments baked onto the exposed faces of the current world. */
internal object PaperWorldMesh {
    const val QUADS_PER_CHUNK = 8192
    const val STRIDE = 16

    data class Mesh(
        val land: List<ByteBuffer>,
        val water: List<ByteBuffer>,
        val terrainQuads: Int,
        val buildingQuads: Int,
        val sceneryQuads: Int,
        val sceneryObjects: Int,
        val reefVoxels: Int,
    ) {
        val uploadedBytes = (land + water).sumOf { it.remaining().toLong() } + QUADS_PER_CHUNK * 12L
        val triangles = (land + water).sumOf { it.remaining() / STRIDE / 2 }
    }

    private val terrainColors = mapOf(
        TerrainMaterial.GRASS to 0x8ead75,
        TerrainMaterial.DIRT to 0x8d7458,
        TerrainMaterial.STONE to 0xa1ac9e,
        TerrainMaterial.WATER to 0x62a7a3,
        TerrainMaterial.SAND to 0xe0c693,
        TerrainMaterial.SNOW to 0xebf3e4,
        TerrainMaterial.ICE to 0xb2dce5,
        TerrainMaterial.TERRACOTTA to 0xc88761,
    )

    private val palette by lazy { OriginalMaterialStyles() }
    private fun blockColors(): (RenderVoxel) -> Int {
        val colors = HashMap<Pair<String?,String>,Int>()
        return { voxel -> colors.getOrPut(voxel.sourceBlockId to voxel.materialId) {
            val id = voxel.sourceBlockId.orEmpty()
            when {
                voxel.materialId == "glass" || id.contains("glass") -> 0x83a99e
                voxel.materialId == "roof" && id.isEmpty() -> 0xb66d4e
                else -> palette.voxel(voxel).color
            }
        } }
    }

    private val opaque = NativeRenderMaterial(vertexColors = true, unlit = true, side = NativeFaceSide.DOUBLE)
    private val translucent = opaque.copy(transparent = true, depthWrite = false)
    private fun Quads.appendTo(target: NativePacketBuilder, material: NativeRenderMaterial, priority: Int = 4) {
        val identity = FloatBuffer.wrap(FloatArray(16) { if (it % 5 == 0) 1f else 0f })
        finish().forEach { bytes ->
            target.add(PaperFaceGeometry(bytes), material, identity, castShadow = false, receiveShadow = false, priority = priority)
        }
    }

    fun appendRoot(target: NativePacketBuilder, world: WorldTerrainPlan, allocator: NativePacketAllocator?, cancelled: () -> Boolean) {
        val land = Quads(allocator?.let { it::allocate } ?: ByteBuffer::allocateDirect, cancelled, linear = true)
        val water = Quads(allocator?.let { it::allocate } ?: ByteBuffer::allocateDirect, cancelled, linear = true)
        appendTerrain(world, land, water)
        val color = blockColors()
        for (item in world.scenery.objects) {
            land.blocks(item.blocks.voxels, BlockPoint(0.0, 0.0, 0.0), BlockTransform.translation(item.x, item.y, item.z), color)
        }
        land.appendTo(target, opaque)
        water.appendTo(target, translucent, priority = 5)
    }

    fun appendOwner(target: NativePacketBuilder, voxels: List<RenderVoxel>, foundation: List<RenderVoxel>,
        origin: BlockPoint, pose: NativeStructurePlacement, weathering: Double, allocator: NativePacketAllocator?, cancelled: () -> Boolean) {
        val faces = Quads(allocator?.let { it::allocate } ?: ByteBuffer::allocateDirect, cancelled, linear = true)
        val color = blockColors()
        val transform = pose.parent(origin)
        faces.blocks(voxels, origin, transform, { shade(color(it), 1 - weathering * .26) })
        faces.blocks(foundation, origin, transform, color)
        faces.appendTo(target, opaque)
    }

    fun prepare(world: WorldTerrainPlan, allocator: NativePacketAllocator): Mesh {
        val land = Quads(allocator::allocate)
        val water = Quads(allocator::allocate)
        val terrainQuads = appendTerrain(world, land, water)
        val color = blockColors()
        val beforeBuildings = land.count
        for (building in world.input.buildings) {
            val p = building.placement
            val offset = BlockPoint(building.blueprint.bounds.minX.toDouble(), building.blueprint.bounds.minY.toDouble(), building.blueprint.bounds.minZ.toDouble())
            val transform = NativeStructurePlacement(BlockPoint(p.worldPosition.x, p.worldPosition.y, p.worldPosition.z), p.rotationY, p.blueprintOffset).parent(offset)
            land.blocks(building.recipe.pistonDisplay.voxels, offset, transform, color)
        }
        for (reward in world.rewards) {
            val p = reward.support.placement
            val offset = reward.source.originalGeometry.origin
            val placement = NativeStructurePlacement(BlockPoint(p.worldPosition.x, p.worldPosition.y, p.worldPosition.z), p.rotationY, p.blueprintOffset)
            land.blocks(reward.source.recipe.pistonDisplay.voxels, offset, placement.parent(offset), color)
            land.blocks(reward.support.foundation, offset, placement.parent(offset), color)
        }
        val buildingQuads = land.count - beforeBuildings
        val beforeScenery = land.count
        var reefs = 0
        for (item in world.scenery.objects) {
            val voxels = item.blocks.voxels
            reefs += voxels.count { it.sourceBlockId.orEmpty().contains("_coral") }
            land.blocks(voxels, BlockPoint(0.0, 0.0, 0.0), BlockTransform.translation(item.x, item.y, item.z), color)
        }
        return Mesh(land.finish(), water.finish(), terrainQuads, buildingQuads,
            land.count - beforeScenery, world.scenery.objects.size, reefs)
    }

    private fun appendTerrain(world: WorldTerrainPlan, land: Quads, water: Quads): Int {
        val terrain = world.terrain
        val positions = terrain.positions()
        for (material in TerrainMaterial.entries) {
            val watery = material == TerrainMaterial.WATER
            val layer = if (watery) water else land
            layer.planar(positions, terrain.topIndices(material), terrainColors.getValue(material), alpha = if (watery) 134 else 255)
        }
        for (side in listOf(TerrainMaterial.DIRT, TerrainMaterial.STONE)) {
            land.planar(positions, terrain.sideIndices(side), terrainColors.getValue(side), shadeSides = true)
        }
        val faces = land.count + water.count
        val roads = world.input.spatial.roadGeometry
        land.planar(roads.positions(), roads.indices(), 0xc6a36d)
        return faces
    }

    private data class Face(val x: Int, val y: Int, val z: Int, val corners: IntArray, val shade: Double)
    private val faces = listOf(
        Face(0, 1, 0, intArrayOf(2, 3, 7, 6), 1.06),
        Face(0, -1, 0, intArrayOf(0, 4, 5, 1), .68),
        Face(1, 0, 0, intArrayOf(1, 5, 7, 3), .91),
        Face(-1, 0, 0, intArrayOf(0, 2, 6, 4), .77),
        Face(0, 0, 1, intArrayOf(4, 6, 7, 5), .84),
        Face(0, 0, -1, intArrayOf(0, 1, 3, 2), .72),
    )
    private val planarCorners = intArrayOf(0, 1, 2, 5)

    private fun shade(rgb: Int, ratio: Double): Int {
        fun channel(shift: Int) = (((rgb shr shift) and 255) * ratio).roundToInt().coerceIn(0, 255)
        return channel(16) shl 16 or (channel(8) shl 8) or channel(0)
    }

    private class Quads(private val allocate: (Int) -> ByteBuffer,
        private val cancelled: () -> Boolean = { false }, private val linear: Boolean = false) {
        private val finished = ArrayList<ByteBuffer>()
        private val pigments = HashMap<Int,Int>()
        private var writing = newChunk()
        var count = 0
            private set

        private fun newChunk() = allocate(QUADS_PER_CHUNK * 4 * STRIDE).order(ByteOrder.LITTLE_ENDIAN)

        private fun checkpoint() {
            if (cancelled() || Thread.currentThread().isInterrupted) throw CancellationException("Paper mesh was superseded")
        }

        private fun start() {
            if (count % 1024 == 0) checkpoint()
            if (writing.remaining() == 0) {
                seal()
                writing = newChunk()
            }
            count++
        }

        private fun seal() {
            if (writing.position() == 0) return
            writing.flip()
            finished += writing.asReadOnlyBuffer().order(ByteOrder.nativeOrder())
        }

        fun finish(): List<ByteBuffer> {
            seal()
            return finished
        }

        private fun pigment(rgb: Int) = if (!linear) rgb else pigments.getOrPut(rgb) {
            val c = LinearRgb.fromSrgb(rgb)
            ((c.red * 255).roundToInt() shl 16) or ((c.green * 255).roundToInt() shl 8) or (c.blue * 255).roundToInt()
        }

        private fun vertex(x: Double, y: Double, z: Double, rgb: Int, alpha: Int) {
            writing.putFloat(x.toFloat()).putFloat(y.toFloat()).putFloat(z.toFloat())
            writing.put((rgb shr 16).toByte()).put((rgb shr 8).toByte()).put(rgb.toByte()).put(alpha.toByte())
        }

        fun planar(positions: DoubleBuffer, indices: IntBuffer, color: Int, alpha: Int = 255, shadeSides: Boolean = false) {
            check(indices.remaining() % 6 == 0)
            for (at in 0 until indices.limit() step 6) {
                val first = indices[at] * 3
                val opposite = indices[at + 2] * 3
                val colorAtFace = pigment(if (shadeSides) shade(color, if (abs(positions[first] - positions[opposite]) < .001) .78 else .90) else color)
                start()
                for (corner in planarCorners) {
                    val index = indices[at + corner] * 3
                    vertex(positions[index], positions[index + 1], positions[index + 2], colorAtFace, alpha)
                }
            }
        }

        fun blocks(voxels: List<RenderVoxel>, origin: BlockPoint, transform: BlockTransform, color: (RenderVoxel) -> Int) {
            if (voxels.isEmpty()) return
            // Round only the neighbor search. Source coordinates are still
            // used for the drawn surfaces and their real settlement transform.
            fun key(x: Double, y: Double, z: Double): Long =
                (((x - origin.x) * 16).roundToInt().toLong() shl 42) +
                    (((y - origin.y) * 16).roundToInt().toLong() shl 21) +
                    ((z - origin.z) * 16).roundToInt()
            val occupied = HashSet<Long>(voxels.size * 4 / 3 + 1)
            for ((i,v) in voxels.withIndex()) {
                if (i % 1024 == 0) checkpoint()
                occupied += key(v.x, v.y, v.z)
            }
            val shades = HashMap<Int, IntArray>()
            for ((at,v) in voxels.withIndex()) {
                if (at % 1024 == 0) checkpoint()
                val blockColor = color(v)
                val lighting = shades.getOrPut(blockColor) { faces.map { pigment(shade(blockColor, it.shade)) }.toIntArray() }
                for ((i, face) in faces.withIndex()) {
                    if (key(v.x + face.x, v.y + face.y, v.z + face.z) in occupied) continue
                    start()
                    for (corner in face.corners) {
                        val x = v.x - origin.x + if (corner and 1 != 0) .5 else -.5
                        val y = v.y - origin.y + if (corner and 2 != 0) .5 else -.5
                        val z = v.z - origin.z + if (corner and 4 != 0) .5 else -.5
                        vertex(transform[0] * x + transform[4] * y + transform[8] * z + transform[12],
                            transform[1] * x + transform[5] * y + transform[9] * z + transform[13],
                            transform[2] * x + transform[6] * y + transform[10] * z + transform[14], lighting[i], 255)
                    }
                }
            }
        }
    }
}
