package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class BuildingPreparationTest {
    companion object {private val oracle by lazy{JSONObject(BuildingPreparationTest::class.java.getResource("/building-oracle.json")!!.readText())}}
    private fun rows(value:JSONArray)=List(value.length()){value.getJSONObject(it)}
    private fun equivalent(label:String,expected:Any?,actual:Any?){
        when(expected){
            null,JSONObject.NULL->assertTrue(label,actual==null||actual==JSONObject.NULL)
            is JSONObject->{assertTrue(label,actual is JSONObject);val next=actual as JSONObject
                val keys=expected.keys().asSequence().toSet();assertEquals("$label keys",keys,next.keys().asSequence().toSet());for(key in keys)equivalent("$label.$key",expected.get(key),next.get(key))}
            is JSONArray->{assertTrue(label,actual is JSONArray);val next=actual as JSONArray;assertEquals("$label length",expected.length(),next.length());repeat(expected.length()){equivalent("$label[$it]",expected.get(it),next.get(it))}}
            is Number->{assertTrue(label,actual is Number);assertEquals(label,expected.toDouble(),(actual as Number).toDouble(),1e-12)}
            else->assertEquals(label,expected,actual)
        }
    }
    @Test fun sourceFingerprintsBindTheOracleToTheCurrentFormalAlgorithms(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/environment.ts").isFile}
        val hashes=oracle.getJSONObject("sourceHashes")
        for(path in hashes.keys()){
            val digest=MessageDigest.getInstance("SHA-256").digest(File(root,path).readBytes()).joinToString(""){"%02x".format(it.toInt() and 255)}
            assertEquals("Stale building oracle: $path",hashes.getString(path),digest)
        }
    }
    @Test fun blueprintMetadataNormalizationAndAllBundledInputsRetainTheirRenderSemantics(){
        val blueprints=rows(oracle.getJSONArray("blueprints"));assertTrue(blueprints.size>300)
        for((index,value)in blueprints.withIndex())equivalent("blueprint $index",value.get("normalized"),BlueprintSnapshot.read(value.getJSONObject("input")).json())
        val catalog=BuiltinBlueprintCatalog.load()
        for(entry in catalog.entries){
            val input=catalog.content(entry.id).json();val snapshot=BlueprintSnapshot.read(input,entry.category in setOf("daily","holiday","birthday"))
            equivalent(entry.id,input,snapshot.json());assertEquals(entry.voxelCount,snapshot.voxels.size)
            assertEquals(entry.bounds,snapshot.bounds)
        }
    }
    @Test fun arbitraryConstructionConditionPistonAndOcclusionCasesMatchTheActualFormalPipeline(){
        val snapshots=rows(oracle.getJSONArray("blueprints")).map{BlueprintSnapshot.read(it.getJSONObject("input"))}
        val cases=rows(oracle.getJSONArray("cases"));assertTrue(cases.size>400)
        for(case in cases){
            val label=case.getString("name")
            val recipe=BuildingPreparation.prepare(snapshots[case.getInt("blueprint")],case.getString("projectId"),case.getInt("completion"),case.getInt("condition"))
            equivalent("$label display",case.get("display"),JSONArray(recipe.pistonDisplay.voxels.map(BlueprintSnapshot::voxelJson)))
            equivalent("$label intact",case.get("intact"),JSONArray(recipe.intact.map(BlueprintSnapshot::voxelJson)))
            equivalent("$label missing",case.get("missing"),JSONArray(recipe.missing.map(BlueprintSnapshot::voxelJson)))
            equivalent("$label vines",case.get("vines"),JSONArray(recipe.vines.map{JSONObject().put("x",it.x).put("y",it.y).put("z",it.z).put("axis",it.axis)}))
            assertEquals(label,case.getDouble("weathering"),recipe.weathering,0.0)
            equivalent("$label resolved",case.get("resolved"),JSONArray(recipe.pistonDisplay.resolved.map{JSONObject().put("sourceIndex",it.sourceIndex).put("displayIndex",it.displayIndex)}))
            equivalent("$label omitted",case.get("unresolved"),JSONArray(recipe.pistonDisplay.unresolved.map{JSONObject().put("sourceIndex",it.sourceIndex).put("reason",it.reason)}))
            val occlusion=case.getJSONArray("occlusion");val words=case.getJSONArray("faceWords")
            assertEquals(label,recipe.intact.size,occlusion.length())
            for(index in recipe.intact.indices){assertEquals("$label occlusion $index",occlusion.getDouble(index).toFloat(),recipe.occlusion(index),0f);assertEquals("$label face word $index",words.getInt(index),recipe.faceWord(index))}
        }
    }
    @Test fun numberAndJsonSpellingsPreserveSourceHashInputsAcrossRuntimes(){
        for(value in rows(oracle.getJSONArray("numbers")))assertEquals(value.toString(),value.getString("text"),SourceNumbers.text(value.getDouble("value")))
        for(value in rows(oracle.getJSONArray("strings")))assertEquals(value.getString("quoted"),SourceNumbers.quoted(value.getString("value")))
    }
    @Test fun sourceGraphsAndPublishedRecipeCollectionsCannotBeMutatedAndIdentityUsesActualGeometry(){
        val raw=JSONObject(oracle.getJSONArray("blueprints").getJSONObject(0).getJSONObject("input").toString())
        val snapshot=BlueprintSnapshot.read(raw);val before=snapshot.json().toString();val key=snapshot.geometrySha
        raw.getJSONArray("voxels").remove(0);raw.put("title","changed")
        assertEquals(before,snapshot.json().toString());assertEquals(key,snapshot.geometrySha)
        assertThrows(UnsupportedOperationException::class.java){(snapshot.voxels as MutableList).clear()}
        val state=snapshot.voxels.first{it.sourceBlockState!=null}.sourceBlockState!!
        assertThrows(UnsupportedOperationException::class.java){(state as MutableMap).clear()}
        assertThrows(UnsupportedOperationException::class.java){(snapshot.voxels.first{it.sign!=null}.sign!!.front.lines as MutableList).clear()}
        val renamed=snapshot.json().put("id","renamed").put("title","new title")
        assertEquals(key,BlueprintSnapshot.read(renamed).geometrySha)
        val altered=snapshot.json();altered.getJSONArray("voxels").getJSONObject(3).put("materialId","glass")
        assertNotEquals(key,BlueprintSnapshot.read(altered).geometrySha)
        val recipe=BuildingPreparation.prepare(snapshot,"p",10000,7777)
        assertThrows(UnsupportedOperationException::class.java){(recipe.intact as MutableList).clear()}
        assertEquals(recipe.key,BuildingPreparation.prepare(BlueprintSnapshot.read(renamed),"p",10000,7777).key)
        assertNotEquals(recipe.key,BuildingPreparation.prepare(snapshot,"p",9999,7777).key)
        assertNotEquals(recipe.key,BuildingPreparation.prepare(snapshot,"other",10000,7777).key)
    }
    @Test fun denseAndFractionalOcclusionKeepTheSameFacesWithoutBoxedNeighborStorage(){
        val voxels=(0 until 2048).map{i->RenderVoxel((i%32).toDouble(),(i/128).toDouble(),(i/32%4).toDouble(),
            if(i%7==0)"Glass"else"stone",0,if(i%11==0)"minecraft:OAK_LEAVES"else"minecraft:stone")}
        val shifted=voxels.map{it.copy(x=it.x+.5,y=it.y+.5,z=it.z+.5)}
        val dense=LocalBlockOcclusion(voxels);val fractional=LocalBlockOcclusion(shifted)
        assertTrue("Dense buildings need at most one bit per occupied bounding cell",dense.storageBytes<=256)
        assertTrue("Fractional input remains compact",fractional.storageBytes<=voxels.size*16L)
        for(i in voxels.indices){
            assertArrayEquals(dense.levels(voxels[i]),fractional.levels(shifted[i]))
            for(face in 0..5)assertEquals(dense.normalOccupied(voxels[i],face),fractional.normalOccupied(shifted[i],face))
        }
    }
    @Test fun invalidInputsAndCancelledBuildsNeverYieldAPartialOrGuessedRecipe(){
        fun raw()=JSONObject(oracle.getJSONArray("blueprints").getJSONObject(0).getJSONObject("input").toString())
        for(change in listOf<(JSONObject)->Unit>(
            {it.getJSONArray("voxels").getJSONObject(0).put("x",1.5)},
            {it.getJSONArray("voxels").put(it.getJSONArray("voxels").get(0))},
            {it.getJSONObject("bounds").put("maxX",200)},
            {it.getJSONArray("voxels").getJSONObject(0).put("sourceBlockState",JSONObject().put("__proto__","bad"))},
            {it.getJSONArray("voxels").getJSONObject(0).put("sourceBlockState",JSONObject().put("valid",""))},
            {it.getJSONArray("voxels").getJSONObject(0).put("emissiveLevel",16)},
            {it.getJSONArray("voxels").getJSONObject(0).getJSONObject("sign").getJSONObject("front").put("lines",JSONArray(listOf("unsafe\nline")))}
        )){val value=raw();change(value);assertTrue(runCatching{BlueprintSnapshot.read(value)}.isFailure)}
        val snapshot=BlueprintSnapshot.read(raw())
        assertThrows(IllegalArgumentException::class.java){BuildingPreparation.prepare(snapshot,"p",10001,10000)}
        assertThrows(CancellationException::class.java){BuildingPreparation.prepare(snapshot,"p",10000,10000){true}}
        var checks=0
        assertThrows(CancellationException::class.java){BuildingPreparation.prepare(snapshot,"p",10000,0){++checks>=4}}
        assertTrue(checks>=4)
        assertEquals(snapshot.voxels.size,BuildingPreparation.prepare(snapshot,"p",10000,10000).intact.size)
    }
}
