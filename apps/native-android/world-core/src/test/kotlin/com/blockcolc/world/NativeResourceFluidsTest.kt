package com.blockcolc.world
import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.CancellationException
class NativeResourceFluidsTest {
 private fun voxels(a:JSONArray)=List(a.length()){i->val v=a.getJSONObject(i);val state=v.optJSONObject("sourceBlockState");RenderVoxel(v.getDouble("x"),v.getDouble("y"),v.getDouble("z"),"stone",0,v.optString("sourceBlockId"),state?.keys()?.asSequence()?.associateWith{state.getString(it)})}
 @Test fun matchesFormalAtlasRoutingAndEverySurfaceCorner(){
  val rows=JSONObject(javaClass.getResource("/resource-fluid-oracle.json")!!.readText()).getJSONArray("cases");assertTrue(rows.length()>300)
  repeat(rows.length()){n->val row=rows.getJSONObject(n);val tiles=row.getJSONArray("tiles")
   val entries=List(tiles.length()){i->val t=tiles.getJSONObject(i);ResourceAtlasEntry(t.getString("resourceId"),i,t.getInt("page"),t.getInt("pageTextureIndex"),0,0,16,ResourceAtlasUv(0.0,0.0,1.0,1.0),t.getString("alphaMode"),null)}
   val atlas=ResourceTextureAtlas(16,2,1,List(2){ResourceAtlasPage(it,16,16,16,1,1,ByteArray(1024))},entries,emptyMap())
   val v=voxels(row.getJSONArray("voxels"));val neighboring=if(row.isNull("neighbors"))v else voxels(row.getJSONArray("neighbors"));val contained=row.getBoolean("waterlogged")
   val actual=NativeResourceFluidPlanner().plan(v,atlas,neighboring)
   val batches=actual.batches.filter{it.waterlogged==contained};val expected=row.getJSONArray("batches");val label=row.getString("name")
   assertEquals(label,expected.length(),batches.size)
   repeat(expected.length()){j->val e=expected.getJSONObject(j);val a=batches[j];assertEquals(label,e.getString("kind"),a.kind.name.lowercase());assertEquals(e.getDouble("height"),a.height,1e-12);assertEquals(e.getInt("page"),a.page);assertEquals(e.getInt("mask"),a.faceMask);assertEquals(e.getString("alpha"),a.alphaMode)
    val members=e.getJSONArray("entries");assertEquals(members.length(),a.entries.size)
    repeat(members.length()){k->val m=members.getJSONObject(k);val f=a.entries[k];assertEquals(label,m.getInt("index"),f.surface.sourceIndex);assertEquals(m.getBoolean("flowing"),f.surface.flowing);assertEquals(m.getDouble("angle"),f.surface.flowAngle,1e-12)
     repeat(4){axis->assertEquals(m.getJSONArray("corners").getDouble(axis),f.surface.corners[axis],1e-12)};repeat(6){face->assertEquals(m.getJSONArray("tiles").getInt(face),f.faceTiles[face])}}
   }
   assertEquals(row.getInt("accepted"),(if(contained)actual.acceptedWaterlogged else actual.acceptedFree).size)
   assertEquals((0 until row.getJSONArray("fallback").length()).map{row.getJSONArray("fallback").getInt(it)}.toSet(),actual.fallbackBatches.filter{it.waterlogged==contained}.flatMap{it.entries.map{e->e.sourceIndex}}.toSet())
  }
 }
 @Test fun missingAtlasKeepsFluidFallbackAndCancellationCannotPublish(){
  val v=listOf(RenderVoxel(0.0,0.0,0.0,"stone",0,"minecraft:water",mapOf("level" to "0")),RenderVoxel(2.0,0.0,0.0,"stone",1,"minecraft:oak_slab",mapOf("waterlogged" to "true")))
  val plan=NativeResourceFluidPlanner().plan(v,null);assertTrue(plan.batches.isEmpty());assertEquals(2,plan.fallbackBatches.size)
  assertThrows(CancellationException::class.java){NativeResourceFluidPlanner().plan(v,null,cancelled={true})}
 }
 @Test fun batchesStayBoundedAndWaterloggedAdmissionIsIndependent(){
  val tile=ResourceAtlasEntry("minecraft:block/water_still",0,0,0,0,0,16,ResourceAtlasUv(0.0,0.0,1.0,1.0),"opaque",null)
  val atlas=ResourceTextureAtlas(16,2,1,listOf(ResourceAtlasPage(0,16,16,16,1,1,ByteArray(1024))),listOf(tile),emptyMap())
  val v=List(4900){RenderVoxel(it*2.0,0.0,0.0,"stone",it,"minecraft:oak_slab",mapOf("waterlogged" to "true"))}
  val plan=NativeResourceFluidPlanner().plan(v,atlas)
  assertEquals(4900,plan.acceptedWaterlogged.size);assertTrue(plan.acceptedFree.isEmpty());assertEquals(listOf(4096,804),plan.batches.map{it.entries.size})
  assertTrue(plan.batches.all{it.alphaMode=="translucent"&&it.waterlogged})
  assertThrows(IllegalArgumentException::class.java){NativeResourceFluidPlanner().plan(v,atlas,maximumWorkingBytes=128)}
  assertThrows(UnsupportedOperationException::class.java){(plan.batches.first().entries.first().faceTiles as MutableList<Int>)[0]=99}
 }

}
