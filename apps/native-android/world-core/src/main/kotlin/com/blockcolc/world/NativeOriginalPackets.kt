package com.blockcolc.world

import com.blockcolc.world.generation.*
import java.nio.FloatBuffer
import java.util.concurrent.CancellationException
import kotlin.math.abs

/** Parent transform restores the rebased blueprint origin in Double before
 * narrowing. Adding two huge Float translations would lose a small building
 * entirely when a legitimate imported blueprint has a distant source origin. */
data class NativeStructurePlacement(val position:BlockPoint,val rotationY:Double=0.0,val offset:Position2=Position2(0.0,0.0)) {
    init {require(rotationY.isFinite()&&offset.x.isFinite()&&offset.z.isFinite())}
    fun parent(origin:BlockPoint):BlockTransform=BlockTransform.translation(position.x,position.y,position.z)*BlockTransform.rotationY(rotationY)*
        BlockTransform.translation(offset.x+origin.x,origin.y,offset.z+origin.z)
}

/** Append all routes to an owner's packet builder. It may also append support,
 * scenery or vines without creating another renderer or GPU resource owner. */
class NativeOriginalPackets(private val materials:NativeOriginalMaterials=NativeOriginalMaterials()) {
    private val indexedCube by lazy {
        val cube = CuboidGeometry.create()
        val corners = intArrayOf(0, 1, 2, 4)
        val triangle = intArrayOf(0, 1, 2, 1, 3, 2)
        fun attribute(source: FloatBuffer, width: Int) = FloatArray(24 * width) { index ->
            val vertex = index / width
            source.get((vertex / 4 * 6 + corners[vertex % 4]) * width + index % width)
        }
        AttributeBlockGeometry(attribute(cube.positions(), 3), attribute(cube.normals(), 3),
            attribute(checkNotNull(cube.textureCoordinates()), 2),
            index = IntArray(36) { at -> at / 6 * 4 + triangle[at % 6] })
    }

    private fun OriginalDrawBatch.opaqueCube(): Boolean {
        val style = (material as? OriginalDrawMaterial.Pattern)?.style ?: return false
        return route == OriginalDrawRoute.CUBE && emission.level == 0 && !style.transparent && style.opacity == 1.0
    }

    private fun exposedCubeFaces(structure: OriginalStructure, voxels: List<RenderVoxel>, excluded: Set<Int>,
        cancelled: () -> Boolean): ByteArray? {
        val admitted = ArrayList<RenderVoxel>()
        val masks = ByteArray(voxels.size) { ALL_CUBE_FACES.toByte() }
        fun check(index: Int) {
            if (index % 128 == 0 && (cancelled() || Thread.currentThread().isInterrupted)) {
                throw CancellationException("Original cube visibility superseded")
            }
        }
        for (batch in structure.batches) {
            if (!batch.opaqueCube()) continue
            val members = batch.instanceMembers()
            while (members.hasRemaining()) {
                check(members.position())
                val index = members.get()
                if (index !in voxels.indices || index in excluded) continue
                val voxel = voxels[index]
                // Keep comparisons exact where imported coordinates have small local offsets.
                if (maxOf(abs(voxel.x), abs(voxel.y), abs(voxel.z)) > 1e12) continue
                admitted.add(voxel)
                masks[index] = -1
            }
        }
        if (admitted.size < 2) return null
        val occupied = VoxelCoordinateIndex(admitted, cancelled = cancelled)
        var concealed = false
        for (index in masks.indices) {
            check(index)
            if (masks[index].toInt() != -1) continue
            val (x,y,z) = voxels[index]
            var mask = ALL_CUBE_FACES
            if (occupied[x+1,y,z] != null) mask = mask xor 1
            if (occupied[x-1,y,z] != null) mask = mask xor 2
            if (occupied[x,y+1,z] != null) mask = mask xor 4
            if (occupied[x,y-1,z] != null) mask = mask xor 8
            if (occupied[x,y,z+1] != null) mask = mask xor 16
            if (occupied[x,y,z-1] != null) mask = mask xor 32
            masks[index] = mask.toByte()
            concealed = concealed || mask != ALL_CUBE_FACES
        }
        return masks.takeIf { concealed }
    }

    fun append(target:NativePacketBuilder,structure:OriginalStructure,placement:NativeStructurePlacement,state:NativeSurfaceState,weathering:Double=0.0,
        lod:SceneryLod?=null,skippedMembers:Set<Int> = emptySet(),cancelled:()->Boolean={false},fog:Boolean=true,
        cubeContacts:List<RenderVoxel>?=null) {
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Original packet preparation superseded")}
        checkpoint();val parent=placement.parent(structure.origin)
        // One scratch matrix per append. Scenery can contain hundreds of
        // thousands of instances; immutable transforms for every row created
        // three short-lived DoubleArrays per instance on the Android path.
        val local=DoubleArray(16)
        val exposed = cubeContacts?.let { exposedCubeFaces(structure, it, skippedMembers, cancelled) }
        for(batch in structure.batches) {
            checkpoint()
            val masks = exposed?.takeIf { batch.opaqueCube() }
            val members = if (skippedMembers.isEmpty() && masks == null) null else batch.instanceMembers()
            val selected = members?.let { IntArray(batch.instanceCount) }
            val count = if (members == null || selected == null) batch.instanceCount else {
                var retained = 0
                for (row in 0 until batch.instanceCount) {
                    if (row % 128 == 0) checkpoint()
                    val member = members.get(row)
                    if (member !in skippedMembers && (masks == null || masks[member].toInt() != 0)) {
                        selected[retained++] = row
                    }
                }
                retained
            }
            if (count == 0) continue
            // A scenery owner can append many batches before its final packet
            // is serialized. Keep those instance rows in the same scoped
            // storage as packet payloads, rather than retaining every batch's
            // second set of large FloatArrays on ART until the owner completes.
            val matrix=batch.matrices();val transformed=NativePacketBuffers.floats(count*16);val colors=NativePacketBuffers.floats(count*4)
            val ao=batch.occlusion();val face=batch.faceOcclusion();val response=batch.materialResponse();val aux=NativePacketBuffers.floats(count*4)
            repeat(count){instance->if(instance%128==0)checkpoint();val original=selected?.get(instance)?:instance
                repeat(16){local[it]=matrix.get(original*16+it).toDouble().also{v->require(v.isFinite())}}
                require(local[3]==0.0&&local[7]==0.0&&local[11]==0.0&&local[15]==1.0)
                // Preserve BlockTransform.times' Double operation order before
                // the one Float narrowing, including rebased distant origins.
                for(column in 0..3)for(row in 0..3){val at=column*4
                    val value=parent[row]*local[at]+parent[4+row]*local[at+1]+parent[8+row]*local[at+2]+parent[12+row]*local[at+3]
                    transformed.put(instance*16+at+row,value.toFloat().also{v->require(v.isFinite())})
                }
                val brightness=1-ao.get(original)*state.ambientOcclusion*.7f
                repeat(3){colors.put(instance*4+it,brightness)};colors.put(instance*4+3,1f)
                val faceWord = face.get(original)
                val mask = masks?.get(checkNotNull(members).get(original))?.toInt() ?: ALL_CUBE_FACES
                // Preserve the low 12 bits of AO. Fluids and moving entities
                // use their own encodings and are never eligible for this mask.
                val packedFace = if (mask == ALL_CUBE_FACES) faceWord else CUBE_MASK_BASE + (mask shl 12) + faceWord
                aux.put(instance*4,packedFace.toFloat());aux.put(instance*4+1,response.get(original).toFloat())
                aux.put(instance*4+2,0f);aux.put(instance*4+3,0f)
            }
            val material=materials.batch(batch,weathering,state).let{if(fog)it else it.copy(fog=false)}
            val flower=batch.route==OriginalDrawRoute.FLOWER;val contained=(batch.material as? OriginalDrawMaterial.Fluid)?.waterlogged==true
            target.add(if (masks == null) batch.geometry else indexedCube,material,transformed,colors,aux,
                castShadow=!flower&&batch.route!=OriginalDrawRoute.FLUID&&!material.transparent,receiveShadow=!contained,priority=if(material.transparent)5 else 4,lod=lod)
        }
        checkpoint()
    }
    fun build(owner:String,structure:OriginalStructure,placement:NativeStructurePlacement,state:NativeSurfaceState,weathering:Double=0.0,
        cancelled:()->Boolean={false}):NativePacketSource=NativePacketBuilder(owner).also{append(it,structure,placement,state,weathering,cancelled=cancelled)}.build(cancelled)

    private companion object {
        const val ALL_CUBE_FACES = 63
        const val CUBE_MASK_BASE = 524288
    }
}
