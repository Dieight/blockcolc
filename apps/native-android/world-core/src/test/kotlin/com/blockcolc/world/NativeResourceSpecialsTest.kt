package com.blockcolc.world
import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Test
import org.junit.Assert.*
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.io.File
import java.util.Base64
import java.util.zip.*

class NativeResourceSpecialsTest {
 companion object {val oracle by lazy{JSONObject(NativeResourceSpecialsTest::class.java.getResource("/resource-special-oracle.json")!!.readText())}}
 private fun voxel(id:String,state:JSONObject=JSONObject())=RenderVoxel(0.0,0.0,0.0,"stone",0,id,state.keys().asSequence().associateWith{state.getString(it)})
 private fun voxels(a:JSONArray)=List(a.length()){i->val v=a.getJSONObject(i);voxel(v.getString("sourceBlockId"),v.optJSONObject("sourceBlockState")?:JSONObject()).copy(x=v.getDouble("x"),y=v.getDouble("y"),z=v.getDouble("z"))}
 private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt()and 255)}
 private fun hash(g:BlockGeometry):String{val hash=MessageDigest.getInstance("SHA-256");val n=ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN)
  for(b in listOf(g.positions(),g.normals(),g.textureCoordinates()!!)){while(b.hasRemaining()){n.clear();n.putFloat(b.get());hash.update(n.array())}}
  g.indices()?.let{ix->while(ix.hasRemaining()){n.clear();n.putInt(ix.get());hash.update(n.array())}}
  return hash.digest().joinToString(""){"%02x".format(it.toInt()and 255)}
 }
 private fun zip(change:(MutableMap<String,ByteArray>)->Unit={}):ByteArray{
  val files=linkedMapOf<String,ByteArray>();ZipInputStream(Base64.getDecoder().decode(oracle.getString("zip")).inputStream()).use{input->while(true){val e=input.nextEntry?:break;files[e.name]=input.readBytes()}}
  change(files);val out=java.io.ByteArrayOutputStream();ZipOutputStream(out).use{z->for((name,bytes)in files){z.putNextEntry(ZipEntry(name));z.write(bytes);z.closeEntry()}};return out.toByteArray()
 }
 @Test fun allFormalSpecialStatesMatchModelsTransformsMaterialsAndMissingPartFallback(){
  val cases=oracle.getJSONArray("cases");assertTrue(cases.length()>1400)
  NativeResourceArchive.from(zip()).use{archive->val assets=ResourcePackAssets.prepare(archive);val stack=ResourcePackStack.of(assets);val compiler=NativeResourceSpecialCompiler(stack)
   repeat(cases.length()){i->val row=cases.getJSONObject(i);val id=row.getString("id");val state=row.getJSONObject("state");val v=voxel(id,state)
    val actual=if(row.isNull("missing"))compiler.compile(v,0)else NativeResourceArchive.from(zip{files->files.remove("assets/"+row.getString("missing").replace(":","/textures/")+".png")}).use{removed->NativeResourceSpecialCompiler(ResourcePackStack.of(ResourcePackAssets.prepare(removed))).compile(v,0)}
    val label="$i:$id:$state:${row.optString("missing")}";assertEquals(label,row.getBoolean("handled"),actual!=null)
    if(actual!=null){val expected=row.getJSONArray("parts");assertEquals(label,expected.length(),actual.size)
     for(j in actual.indices){val a=actual[j];val e=expected.getJSONObject(j);assertEquals(label,e.getString("geometry"),hash(a.part.geometry));val m=e.getJSONArray("matrix")
      repeat(16){k->assertEquals("$label matrix$k",m.getDouble(k),a.pose[k].toFloat().toDouble(),1e-6)}
      repeat(3){k->assertEquals(label,e.getJSONArray("color").getDouble(k),a.material.color[k].toDouble(),1e-6)}
      assertEquals(label,e.getDouble("roughness"),a.material.roughness.toDouble(),1e-6);assertEquals(label,e.getDouble("alpha"),a.material.alphaCutoff.toDouble(),1e-6)
      assertEquals(label,e.getBoolean("transparent"),a.material.transparent);assertEquals(label,e.getBoolean("unlit"),a.material.unlit);assertEquals(label,e.getBoolean("flipY"),a.material.flipY);assertEquals(label,e.getInt("side"),a.material.side.code)
      val pixels=stack.specialTextures.getValue(e.getString("texture")).decode().rgba();val bytes=ByteArray(pixels.remaining());pixels.get(bytes);assertEquals(label,sha(bytes),a.material.texture!!.sha256)
     }
    }
   }
  }
 }
 @Test fun fluidVerticesUvTintAndPageMasksMatchTheFormalAtlasVertexProgram(){
  NativeResourceArchive.from(zip()).use{archive->val stack=ResourcePackStack.of(ResourcePackAssets.prepare(archive));val atlas=NativeResourceAtlas.build(stack);val rows=oracle.getJSONArray("fluid");assertTrue(rows.length()>40)
   repeat(rows.length()){i->val row=rows.getJSONObject(i);val v=voxels(row.getJSONArray("voxels"));val plan=NativeResourceFluidPlanner().plan(v,atlas)
    val b=plan.batches.single{it.waterlogged==row.getBoolean("waterlogged")&&it.page==row.getInt("page")&&it.faceMask==row.getInt("mask")&&it.entries.any{e->e.surface.sourceIndex==row.getInt("member")}}
    val entry=b.entries.single{it.surface.sourceIndex==row.getInt("member")};val g=NativeResourceFluidGeometry.compile(b,entry,atlas,ResourceBiomePalette());val expected=row.getJSONArray("vertex");assertEquals(expected.length(),g.vertexCount*12)
    val arrays=listOf(g.positions(),g.normals(),g.textureCoordinates()!!,g.colors()!!,g.colorAlpha()!!)
    repeat(g.vertexCount){vertex->val values=FloatArray(12){k->when(k){in 0..2->arrays[0].get(vertex*3+k);in 3..5->arrays[1].get(vertex*3+k-3);in 6..7->arrays[2].get(vertex*2+k-6);in 8..10->arrays[3].get(vertex*3+k-8);else->arrays[4].get(vertex)}}
      repeat(12){channel->assertEquals("fluid$i vertex$vertex channel$channel",expected.getDouble(vertex*12+channel),values[channel].toDouble(),1e-6)}}
   }
  }
 }
 @Test fun realArchivePixelsMatchFormalDecodeWithoutBundlingAnyOriginalArchive(){
  val archives=oracle.getJSONArray("real");assertEquals(5,archives.length());var count=0
  repeat(archives.length()){i->val row=archives.getJSONObject(i);val file=File(row.getString("file"));assertTrue(file.isFile);assertEquals(row.getString("sha256"),sha(file.readBytes()))
   NativeResourceArchive.open(file).use{archive->val expected=row.getJSONArray("textures");repeat(expected.length()){j->val e=expected.getJSONObject(j);val decoded=ResourcePng.decode(archive.read(e.getString("path")),ResourcePngLimits(1024,1024));assertEquals(e.getInt("width"),decoded.width);assertEquals(e.getInt("height"),decoded.height);val bytes=decoded.rgba().let{b->ByteArray(b.remaining()){b.get()}};assertEquals("$i:${e.getString("path")}",e.getString("rgbaSha256"),sha(bytes));count++}}
  };assertTrue(count>100)
 }
 @Test fun customModelsWinAndMetadataSurvivesBothBodyRoutes(){
  val ids=listOf("chest","oak_sign","campfire");val faces=listOf("down","up","north","south","west","east")
  NativeResourceArchive.from(zip{files->for(id in ids){files["assets/minecraft/blockstates/$id.json"]=JSONObject().put("variants",JSONObject().put("",JSONObject().put("model","minecraft:block/test"))).toString().toByteArray()}
    files["assets/minecraft/models/block/test.json"]=JSONObject().put("textures",JSONObject().put("all","minecraft:block/water_still")).put("elements",JSONArray().put(JSONObject().put("from",JSONArray(listOf(0,0,0))).put("to",JSONArray(listOf(16,16,16))).put("faces",JSONObject().also{o->faces.forEach{o.put(it,JSONObject().put("texture","#all"))}}))).toString().toByteArray()
  }).use{archive->val stack=ResourcePackStack.of(ResourcePackAssets.prepare(archive));val textures=NativeAtlasTextures.prepare(NativeResourceAtlas.build(stack));val compiler=NativeResourceStructureCompiler(stack,textures)
   val sign=SignText(SignFace(listOf("synthetic"),"red",true),SignFace(emptyList(),"black",false));val v=listOf(voxel("minecraft:chest"),voxel("minecraft:oak_sign").copy(x=2.0,sign=sign),voxel("minecraft:campfire").copy(x=4.0,campfire=listOf(CampfireItem(0,"minecraft:apple",2))))
   val recipe=BuildingPreparation.staticStructure(v,"custom-specials");val resource=compiler.compile(recipe);assertEquals(setOf(0,1,2),resource.acceptedMembers);assertTrue(resource.specials.isEmpty())
   for(fallback in listOf(emptySet<Int>(),setOf(1,2))){val plan=NativeStaticBlockEntities().prepare(listOf(NativeBlockEntityRequest("building:test",recipe.intact,fallback))).getValue("building:test");assertEquals(1,plan.signs.size);assertEquals(1,plan.campfires.size);assertEquals("synthetic",plan.signs.single().front!!.lines.first());assertEquals(1,plan.campfires.single().markers.size);assertEquals(fallback,plan.replacedIndices)}
  }
 }
 @Test fun texturedFluidsConsumeOnlyTheirOwnLayersAndShareOneOwnerAnimationTable(){
  NativeResourceArchive.from(zip{files->files["assets/minecraft/blockstates/oak_slab.json"]=JSONObject().put("variants",JSONObject().put("",JSONObject().put("model","minecraft:block/slab"))).toString().toByteArray()
   files["assets/minecraft/models/block/slab.json"]=JSONObject().put("textures",JSONObject().put("all","minecraft:block/water_still")).put("elements",JSONArray().put(JSONObject().put("from",JSONArray(listOf(0,0,0))).put("to",JSONArray(listOf(16,8,16))).put("faces",JSONObject().also{o->listOf("down","up","north","south","west","east").forEach{o.put(it,JSONObject().put("texture","#all"))}}))).toString().toByteArray()
  }).use{archive->val stack=ResourcePackStack.of(ResourcePackAssets.prepare(archive));val textures=NativeAtlasTextures.prepare(NativeResourceAtlas.build(stack))
   val recipe=BuildingPreparation.staticStructure(listOf(voxel("minecraft:water",JSONObject().put("level","0")),voxel("minecraft:oak_slab",JSONObject().put("waterlogged","true")).copy(x=2.0)),"fluid-layers")
   val resource=NativeResourceStructureCompiler(stack,textures).compile(recipe);val plan=resource.fluids!!.plan;assertEquals(setOf(0),plan.acceptedFree);assertEquals(setOf(1),plan.acceptedWaterlogged);assertEquals(setOf(1),resource.acceptedMembers)
   val fallback=OriginalStructureCompiler().compile(recipe,excludedMembers=resource.acceptedMembers,excludedFreeFluids=plan.acceptedFree,excludedWaterloggedFluids=plan.acceptedWaterlogged)
   assertTrue(fallback.batches.none{it.route==OriginalDrawRoute.FLUID});assertTrue(fallback.batches.isEmpty())
   val owner="building:fluid-layers";val builder=NativePacketBuilder(owner);NativeResourcePackets(textures).append(builder,owner,resource,NativeStructurePlacement(BlockPoint(0.0,0.0,0.0)),NativeSurfaceState());val packets=builder.build()
   assertEquals(2,packets.world!!.packets.count{packets.surfaces[it.material].optics.fluidSurface})
   for(packet in packets.world!!.packets.filter{packets.surfaces[it.material].optics.fluidSurface}){val material=JSONObject(packets.world!!.materials[packet.material]);assertEquals(.76,material.getDouble("opacity"),1e-6);assertTrue(packets.surfaces[packet.material].optics.clearSky!=null)}
   val active=packets.atlasSchedules.flatMap{it.active}.toSet();assertTrue(active.contains(textures.atlas.entry("minecraft:block/water_still")!!.pageTextureIndex));assertTrue(active.contains(textures.atlas.entry("minecraft:block/water_flow")!!.pageTextureIndex))
   assertThrows(java.util.concurrent.CancellationException::class.java){NativeResourceSpecialCompiler(stack).compile(voxel("minecraft:chest"),0,cancelled={true})}
   assertNull(NativeResourceSpecialCompiler(stack,workingBudget=1).compile(voxel("minecraft:chest"),0))
  }
 }

}
