package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.IntBuffer
import java.nio.ReadOnlyBufferException
import java.util.concurrent.CancellationException

class OriginalStructureCompilerTest {
    private fun values(buffer:IntBuffer)=List(buffer.remaining()){buffer.get()}
    private fun blueprint(origin:Long=0L):BlueprintSnapshot {
        fun cell(x:Int,id:String,state:Map<String,String>?=null)=JSONObject().put("x",origin+x).put("y",0).put("z",0).put("materialId","stone").put("buildOrder",if(x==0)0 else 5000)
            .put("sourceBlockId","minecraft:$id").apply{state?.let{put("sourceBlockState",JSONObject(it))}}
        val cells=listOf(cell(0,"poppy"),cell(1,"crafting_table"),cell(2,"glass"),cell(3,"glass"),
            cell(4,"oak_stairs",mapOf("facing" to "north","half" to "bottom","shape" to "straight","waterlogged" to "false")),cell(5,"stone"),cell(6,"water"),cell(7,"barrier"))
        return BlueprintSnapshot.read(JSONObject().put("schemaVersion",1).put("id","routes").put("title","Routes")
            .put("bounds",JSONObject().put("minX",origin).put("maxX",origin+7).put("minY",0).put("maxY",0).put("minZ",0).put("maxZ",0)).put("voxels",JSONArray(cells)))
    }
    private fun recipe(blueprint:BlueprintSnapshot=blueprint(),progress:Int=10000)=BuildingPreparation.prepare(blueprint,"owner",progress,10000)
    @Test fun actualConstructionInputsUseDistinctOriginalRoutesAndKeepEverySourceMember() {
        val recipe=recipe();val mesh=OriginalStructureCompiler().compile(recipe)
        assertEquals(8,mesh.sourceCount);assertEquals(recipe.key,mesh.inputKey)
        assertEquals(OriginalDrawRoute.entries.toSet(),mesh.batches.map{it.route}.toSet())
        assertEquals(listOf(7),values(mesh.invisibleIndices()));assertEquals(listOf(6),values(mesh.fluidIndices()))
        assertFalse(mesh.blockEntityIndices().hasRemaining())
        val members=mesh.batches.flatMap{values(it.members())};assertEquals((0..6).toSet(),members.toSet())
        assertEquals(7,members.distinct().size)
        val glass=mesh.batches.single{it.route==OriginalDrawRoute.JOINED_GLASS}
        assertEquals(listOf(2,3),values(glass.members()));assertEquals(listOf(-1),values(glass.instanceMembers()));assertEquals(1,glass.instanceCount)
        assertEquals(40,glass.geometry.vertexCount) // two cubes, hidden contact faces removed
        assertTrue(mesh.batches.all{it.geometry.positions().remaining()>0})
        val cube=mesh.batches.single{it.route==OriginalDrawRoute.CUBE};assertEquals(listOf(5),values(cube.instanceMembers()))
        assertEquals(recipe.occlusion(5),cube.occlusion().get(),0f);assertEquals(recipe.faceWord(5),cube.faceOcclusion().get())
        val fluid=mesh.batches.single{it.route==OriginalDrawRoute.FLUID};assertEquals(listOf(6),values(fluid.instanceMembers()))
        assertTrue(fluid.faceOcclusion().get()>1_000_000);assertTrue(fluid.materialResponse().get()>0)
        assertTrue(mesh.estimatedBytes>mesh.batches.sumOf{it.instanceByteSize})
    }
    @Test fun coordinatesAreRebasedBeforeFloatNarrowingWithoutMutatingStoredBlueprints() {
        val base=9_007_199_254_740_980L;val source=blueprint(base);val before=source.json().toString()
        val mesh=OriginalStructureCompiler().compile(recipe(source),BlockPoint(base.toDouble(),0.0,0.0))
        assertEquals(base.toDouble(),mesh.origin.x,0.0);assertEquals(before,source.json().toString())
        val all=mesh.batches.filter{it.route!=OriginalDrawRoute.JOINED_GLASS}
        for(batch in all){val matrix=batch.matrices();while(matrix.hasRemaining()){val index=matrix.position();val value=matrix.get();if(index%16==12)assertTrue(value in -.5f..8f)}}
        val cube=mesh.batches.single{it.route==OriginalDrawRoute.CUBE};assertEquals(5f,cube.matrices().get(12),0f)
        val glass=mesh.batches.single{it.route==OriginalDrawRoute.JOINED_GLASS};assertEquals(1.5,glass.geometry.bounds!!.min.x,0.0);assertEquals(3.5,glass.geometry.bounds!!.max.x,0.0)
    }
    @Test fun currentOwnerVersionsAreReusedBoundedAndCancelledReplacementCannotErasePriorMesh() {
        val cache=OriginalStructureCache(budgetBytes=256*1024);val origin=BlockPoint(0.0,0.0,0.0);val input=blueprint();val old=recipe(input,0)
        val first=cache.prepare("a",old,origin);assertSame(first,cache.prepare("a",old,origin))
        assertThrows(CancellationException::class.java){cache.prepare("a",recipe(input),origin,cancelled={true})}
        assertSame(first,cache.prepare("a",old,origin))
        val next=cache.prepare("a",recipe(input),origin);assertNotSame(first,next);assertEquals(1,cache.size)
        val second=cache.prepare("b",recipe(input),origin);assertNotSame(next,second)
        assertSame(next.batches.first().geometry,second.batches.first().geometry)
        assertTrue(cache.retainedBytes<=256*1024);cache.retainOwners(setOf("b"));assertEquals(1,cache.size)
        cache.clear();assertEquals(0,cache.size);assertEquals(0L,cache.retainedBytes);assertTrue(next.batches.isNotEmpty())
        val disabled=OriginalStructureCache(budgetBytes=0);assertNotSame(disabled.prepare("a",old,origin),disabled.prepare("a",old,origin));assertEquals(0,disabled.size)
    }
    @Test fun everyBundledBlueprintCanBeCompiledAtItsActualFullProgressAndOutputsStayImmutable() {
        val catalog=BuiltinBlueprintCatalog.load();val compiler=OriginalStructureCompiler();var voxels=0;var batches=0
        for(entry in catalog.entries){
            val b=BlueprintSnapshot.read(catalog.content(entry.id).json(),entry.category in setOf("daily","holiday","birthday"));val r=BuildingPreparation.prepare(b,entry.id,10000,10000)
            val result=compiler.compile(r,b.bounds.let{BlockPoint(it.minX.toDouble(),it.minY.toDouble(),it.minZ.toDouble())})
            val covered=result.batches.flatMap{values(it.members())}.toSet()+values(result.fluidIndices())+values(result.invisibleIndices())
            assertEquals(entry.id,r.intact.indices.toSet(),covered)
            assertEquals(entry.id,r.intact.size,result.sourceCount)
            for(batch in result.batches){assertThrows(ReadOnlyBufferException::class.java){batch.matrices().put(0,99f)};assertThrows(ReadOnlyBufferException::class.java){batch.members().put(0,99)}}
            assertThrows(UnsupportedOperationException::class.java){(result.batches as MutableList).clear()}
            voxels+=r.intact.size;batches+=result.batches.size
        }
        assertTrue(voxels>38000);assertTrue(batches>200);assertTrue(compiler.retainedAssetBytes<=16L*1024*1024)
        compiler.clear();assertEquals(0L,compiler.retainedAssetBytes)
    }
}
