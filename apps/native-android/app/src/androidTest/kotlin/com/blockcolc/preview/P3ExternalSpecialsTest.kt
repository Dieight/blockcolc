package com.blockcolc.preview
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.blockcolc.world.*
import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
/** Synthetic and offline: no production runtime, actor database or external archives. */
@RunWith(AndroidJUnit4::class)
class P3ExternalSpecialsTest {
 @Test fun normalResourcePacketsKeepSeparateFluidLayersSpecialBodiesAndFallbackMetadata(){
  val oracle=JSONObject(javaClass.getResource("/resource-special-oracle.json")!!.readText());val zip=android.util.Base64.decode(oracle.getString("zip"),android.util.Base64.DEFAULT)
  NativeResourceArchive.from(zip).use{archive->val stack=ResourcePackStack.of(ResourcePackAssets.prepare(archive));val atlas=NativeResourceAtlas.build(stack);val textures=NativeAtlasTextures.prepare(atlas)
   val sign=SignText(SignFace(listOf("synthetic"),"red",true),SignFace(emptyList(),"black",false))
   val v=listOf(RenderVoxel(0.0,0.0,0.0,"stone",0,"minecraft:water",mapOf("level" to "0")),RenderVoxel(2.0,0.0,0.0,"stone",1,"minecraft:oak_slab",mapOf("waterlogged" to "true")),RenderVoxel(4.0,0.0,0.0,"stone",2,"minecraft:chest",mapOf("facing" to "east","type" to "left")),RenderVoxel(6.0,0.0,0.0,"stone",3,"minecraft:dragon_wall_head",mapOf("facing" to "west")),RenderVoxel(8.0,0.0,0.0,"stone",4,"minecraft:red_wall_banner",mapOf("facing" to "north")),RenderVoxel(10.0,0.0,0.0,"stone",5,"minecraft:end_portal"),RenderVoxel(12.0,0.0,0.0,"wood",6,"minecraft:oak_sign",sign=sign))
   val recipe=BuildingPreparation.staticStructure(v,"android-specials");val resource=NativeResourceStructureCompiler(stack,textures).compile(recipe)
   assertEquals(setOf(2,3,4,5),resource.acceptedMembers);assertEquals(setOf(0),resource.fluids!!.plan.acceptedFree);assertEquals(setOf(1),resource.fluids!!.plan.acceptedWaterlogged)
   val entities=NativeStaticBlockEntities(com.blockcolc.preview.world.AndroidSignRasterizer());val entity=entities.prepare(listOf(NativeBlockEntityRequest("building:android-specials",recipe.intact,(recipe.intact.indices.toSet()-resource.acceptedMembers)))).getValue("building:android-specials")
   assertEquals("synthetic",entity.signs.single().front!!.lines.first());assertEquals(setOf(6),entity.replacedIndices)
   val original=OriginalStructureCompiler().compile(recipe,excludedMembers=resource.acceptedMembers+entity.replacedIndices,excludedFreeFluids=resource.fluids!!.plan.acceptedFree,excludedWaterloggedFluids=resource.fluids!!.plan.acceptedWaterlogged)
   assertTrue(original.batches.none{it.route==OriginalDrawRoute.FLUID})
   val target=NativePacketBuilder("building:android-specials");val placement=NativeStructurePlacement(BlockPoint(0.0,0.0,0.0));val state=NativeSurfaceState()
   NativeResourcePackets(textures).append(target,"building:android-specials",resource,placement,state);NativeOriginalPackets().append(target,original,placement,state);entities.append(target,entity,BlockPoint(0.0,0.0,0.0),placement)
   val packets=target.build();assertNotNull(packets.world);assertTrue(packets.surfaces.any{it.optics.fluidSurface});assertTrue(packets.atlasSchedules.isNotEmpty());assertTrue(packets.textures.size>4)
  }
 }
}
