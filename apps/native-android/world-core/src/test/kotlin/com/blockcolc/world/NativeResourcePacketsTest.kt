package com.blockcolc.world

import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64
import java.util.concurrent.CancellationException

class NativeResourcePacketsTest{
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-resource-geometry-oracle.json")!!.readText())}
    private fun row(name:String)=oracle.getJSONArray("cases").let{rows->(0 until rows.length()).map{rows.getJSONObject(it)}.first{it.getString("name")==name}}
    private fun <T> prepared(name:String="simple",block:(ResourcePackStack,NativeAtlasTextures)->T):T=
        NativeResourceArchive.from(Base64.getDecoder().decode(row(name).getString("zip"))).use{archive->val stack=ResourcePackStack.of(ResourcePackAssets.prepare(archive))
            block(stack,NativeAtlasTextures.prepare(NativeResourceAtlas.build(stack)))}
    private fun voxel(x:Double,id:String="minecraft:test")=RenderVoxel(x,0.0,0.0,"stone",x.toInt().coerceAtLeast(0),id)
    @Test fun weightedPositionsReuseOnlyTheSelectedVariantsWithoutChangingTheirGeometry(){
        val input=Base64.getDecoder().decode(row("simple").getString("zip"));val output=java.io.ByteArrayOutputStream()
        java.util.zip.ZipOutputStream(output).use{zip->java.util.zip.ZipInputStream(input.inputStream()).use{source->
            while(true){val entry=source.nextEntry?:break;val bytes=source.readBytes();zip.putNextEntry(java.util.zip.ZipEntry(entry.name))
                if(entry.name=="assets/minecraft/blockstates/test.json"){
                    val state=JSONObject(String(bytes));val variants=state.getJSONObject("variants");val name=variants.keys().next()
                    val model=variants.getJSONObject(name).getString("model")
                    variants.put(name,org.json.JSONArray((0..3).map{JSONObject().put("model",model).put("y",it*90).put("weight",1)}))
                    zip.write(state.toString().toByteArray())
                }else zip.write(bytes)
                zip.closeEntry()
            }
        }}
        NativeResourceArchive.from(output.toByteArray()).use{archive->
            val stack=ResourcePackStack.of(ResourcePackAssets.prepare(archive));val textures=NativeAtlasTextures.prepare(NativeResourceAtlas.build(stack))
            val compiler=NativeResourceStructureCompiler(stack,textures)
            val recipe=BuildingPreparation.staticStructure(List(500){voxel(it.toDouble())},"weighted-reuse")
            val actual=compiler.compile(recipe)
            assertEquals(500,actual.acceptedMembers.size);assertTrue(compiler.cachedModelQueries in 1..4)
            val resolver=stack.resolver()
            for(batch in actual.batches){val members=batch.members();while(members.hasRemaining()){
                val index=members.get();val v=recipe.intact[index]
                val mapped=NativeResourceAtlasMapping.geometry(resolver.geometry("minecraft:test",emptyMap(),ResourceBlockPosition(v.x,v.y,v.z)),textures.atlas)
                val expected=NativeResourceGeometry.compile("minecraft:test",emptyMap(),mapped,textures.atlas) as NativeResourceModelResult.Model
                assertEquals(expected.parts.single().geometry.positions(),batch.part.geometry.positions())
                assertEquals(expected.parts.single().geometry.textureCoordinates(),batch.part.geometry.textureCoordinates())
            }}
        }
    }
    @Test fun groupsSharedModelsKeepsSourceMembershipAndAppendsActualAtlasPackets(){prepared{stack,textures->
        val recipe=BuildingPreparation.staticStructure(listOf(voxel(0.0),voxel(1.0),voxel(2.0),voxel(3.0,"minecraft:missing")),"mixed")
        val compiler=NativeResourceStructureCompiler(stack,textures)
        val structure=compiler.compile(recipe);assertEquals(setOf(0,1,2),structure.acceptedMembers);assertEquals(setOf(3),structure.fallbacks.keys)
        assertEquals(1,structure.batches.size);assertEquals(3,structure.batches.single().instanceCount);assertTrue(structure.batches.single().members().isReadOnly)
        val original=OriginalStructureCompiler().compile(recipe,excludedMembers=structure.acceptedMembers)
        assertEquals(listOf(3),original.batches.flatMap{b->val ids=b.instanceMembers();List(ids.remaining()){ids.get()}})
        val owner="building:pack-test";val state=NativeSurfaceState();val placement=NativeStructurePlacement(BlockPoint(0.0,0.0,0.0));val target=NativePacketBuilder(owner)
        NativeResourcePackets(textures).append(target,owner,structure,placement,state)
        NativeOriginalPackets().append(target,original,placement,state)
        val source=target.build();assertTrue(source.world!!.geometries.any{it.vertexPreparation=="atlas-static-v1"});assertTrue(source.world!!.geometries.any{it.vertexPreparation==null})
        assertTrue(source.surfaces.any{it.optics.atlas!=null});assertTrue(source.surfaces.any{it.optics.atlas==null});assertTrue(compiler.retainedBytes in 1..33554432)
        assertEquals(structure.batches.single().geometryIdentity(),compiler.compile(recipe).batches.single().geometryIdentity())
        compiler.clear();assertEquals(0L,compiler.retainedBytes)
    }}
    private fun NativeResourceDrawBatch.geometryIdentity()=System.identityHashCode(part.geometry)
    @Test fun exclusionPrecedesConnectedGlassMeshingAndRetainsEntityMetadata(){
        val sign=SignText(SignFace(listOf("a"),"black",false),SignFace(emptyList(),"black",false))
        val voxels=listOf(voxel(0.0,"minecraft:glass").copy(materialId="glass",sign=sign),voxel(1.0,"minecraft:glass").copy(materialId="glass"))
        val recipe=BuildingPreparation.staticStructure(voxels,"glass")
        val result=OriginalStructureCompiler().compile(recipe,excludedMembers=setOf(0))
        assertEquals(0,result.blockEntityIndices().get());assertEquals(listOf(1),result.batches.flatMap{b->val ids=b.members();List(ids.remaining()){ids.get()}})
        assertThrows(IllegalArgumentException::class.java){OriginalStructureCompiler().compile(recipe,excludedMembers=setOf(2))}
    }
    @Test fun budgetsCancellationAndAnotherAtlasAreRejectedBeforePublishing(){prepared{stack,textures->
        val recipe=BuildingPreparation.staticStructure(listOf(voxel(0.0)),"one");val compiler=NativeResourceStructureCompiler(stack,textures)
        assertThrows(CancellationException::class.java){compiler.compile(recipe,cancelled={true})}
        assertThrows(IllegalArgumentException::class.java){NativeResourceStructureCompiler(stack,textures,structureBudget=1).compile(recipe)}
        val structure=compiler.compile(recipe);val other=NativeAtlasTextures.prepare(NativeResourceAtlas.build(stack))
        assertThrows(IllegalArgumentException::class.java){NativeResourcePackets(other).append(NativePacketBuilder("building:x"),"building:x",structure,NativeStructurePlacement(BlockPoint(0.0,0.0,0.0)),NativeSurfaceState())}
    }}
    @Test fun largeBlueprintCoordinatesAreRebasedBeforeNarrowing(){prepared{stack,textures->
        val origin=BlockPoint(9e12,0.0,-9e12);val recipe=BuildingPreparation.staticStructure(listOf(voxel(origin.x).copy(z=origin.z),voxel(origin.x+1).copy(z=origin.z)),"distant")
        val structure=NativeResourceStructureCompiler(stack,textures).compile(recipe,origin)
        val matrices=structure.batches.single().matrices();assertEquals(0f,matrices.get(12),0f);assertEquals(1f,matrices.get(28),0f)
        assertEquals(0f,matrices.get(14),0f);assertEquals(0f,matrices.get(30),0f)
    }}
}
