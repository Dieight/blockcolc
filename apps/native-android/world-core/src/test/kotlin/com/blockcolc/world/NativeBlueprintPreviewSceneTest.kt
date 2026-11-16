package com.blockcolc.world

import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CancellationException
import java.util.Base64

class NativeBlueprintPreviewSceneTest {
    @Test fun isolatedScenesDrawActualSourcesWithPreviewCameraCloudsThemeAndNoAnimals(){
        val catalog=BuiltinBlueprintCatalog.load();val compiler=NativeBlueprintPreviewScene()
        try{
            for(entry in listOf(catalog.entries.first{it.category=="native"},catalog.entries.first{it.category=="supplemental"},catalog.entries.first{it.category=="holiday"})){
                val source=BlueprintSnapshot.read(catalog.content(entry.id).json(),entry.category=="holiday")
                val day=compiler.prepare(source,false,.75);val night=compiler.prepare(source,true,1.8)
                assertTrue(day.camera.preview);assertNull(day.animals);assertTrue(day.orbitTargets.isEmpty());assertTrue(day.picking.ids.isEmpty())
                assertTrue(day.sources.first().world!!.packets.isNotEmpty())
                assertTrue(day.sources.first{it.owner=="building:blueprint-preview"}.world!!.packets.isNotEmpty())
                assertTrue(day.sources.any{it.layer==NativePacketLayer.CLOUDS});assertFalse(day.sources.any{it.layer==NativePacketLayer.ANIMALS})
                assertNotEquals(day.lighting.clearColor,night.lighting.clearColor)
                val navigation=NativeWorldNavigation(day.camera,emptyList(),.75);val frame=navigation.frame
                assertEquals(frame.fitted,frame.distance,1e-6);assertEquals(frame.fitted*.65,frame.minimum,1e-6);assertEquals(frame.fitted*1.35,frame.maximum,1e-6)
                navigation.pinch(100.0,10000.0);assertEquals(frame.minimum,navigation.frame.distance,1e-6)
                navigation.resetView();assertEquals(frame.distance,navigation.frame.distance,1e-6)
            }
        }finally{compiler.clear()}
    }
    @Test fun closingOrReplacingPreparationCancelsBeforeDelivery(){
        val catalog=BuiltinBlueprintCatalog.load();val source=BlueprintSnapshot.read(catalog.content("builtin-small-workshop").json())
        val compiler=NativeBlueprintPreviewScene()
        try{assertThrows(CancellationException::class.java){compiler.prepare(source,false,1.0,cancelled={true})}}finally{compiler.clear()}
    }
    @Test fun previewsAdoptOnlyReferencedPackTexturesAndCanReturnToOriginalMaterials(){
        val oracle=JSONObject(javaClass.getResourceAsStream("/native-resource-geometry-oracle.json")!!.bufferedReader().use{it.readText()})
        val cases=oracle.getJSONArray("cases")
        val row=(0 until cases.length()).map{cases.getJSONObject(it)}.first{r->val q=r.getJSONArray("queries");(0 until q.length()).any{q.getJSONObject(it).getJSONObject("expected").optJSONArray("parts")?.length()?.let{n->n>0}==true}}
        val queries=row.getJSONArray("queries");val query=(0 until queries.length()).map{queries.getJSONObject(it)}.first{it.getJSONObject("expected").optJSONArray("parts")?.length()?.let{n->n>0}==true}
        val input=JSONObject().put("schemaVersion",1).put("id","user-preview").put("title","User")
            .put("bounds",JSONObject().put("minX",0).put("maxX",0).put("minY",0).put("maxY",0).put("minZ",0).put("maxZ",0))
            .put("voxels",JSONArray().put(JSONObject().put("x",0).put("y",0).put("z",0).put("materialId","stone").put("buildOrder",10000)
                .put("sourceBlockId",query.getString("blockId")).put("sourceBlockState",query.getJSONObject("state"))))
        val blueprint=BlueprintSnapshot.read(input);val compiler=NativeBlueprintPreviewScene()
        try{NativeResourceArchive.from(Base64.getDecoder().decode(row.getString("zip"))).use{archive->
            val stack=ResourcePackStack.of(ResourcePackAssets.prepare(archive));val ids=NativeBlueprintPreviewScene.textureIds(blueprint,stack)
            assertTrue(ids.isNotEmpty());val assets=NativeResourceWorldAssets.prepare(stack,ids)
            assertEquals(ids,assets.textures.atlas.entries.map{it.resourceId}.toSet())
            val colors=assets.textures.forOwner("building:blueprint-preview").values.map{it.color.identity}.toSet()
            val adopted=compiler.prepare(blueprint,false,1.0,assets).sources.first{it.owner=="building:blueprint-preview"}
            assertTrue(adopted.textures.any{it.identity in colors})
            val restored=compiler.prepare(blueprint,false,1.0).sources.first{it.owner=="building:blueprint-preview"}
            assertFalse(restored.textures.any{it.identity in colors})
            assertThrows(CancellationException::class.java){NativeBlueprintPreviewScene.textureIds(blueprint,stack,{true})}
        }}finally{compiler.clear()}
    }
}
