package com.blockcolc.preview

import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class P3NativeResourceModelsTest {
    private fun equal(expected:Any?,actual:Any?,path:String){
        when(expected){
            null,JSONObject.NULL->assertTrue(path,actual==null||actual===JSONObject.NULL)
            is JSONObject->{assertTrue(path,actual is JSONObject);actual as JSONObject
                val keys=expected.keys().asSequence().toSet();assertEquals(path,keys,actual.keys().asSequence().toSet());keys.forEach{equal(expected.get(it),actual.get(it),"$path.$it")}}
            is JSONArray->{assertTrue(path,actual is JSONArray);actual as JSONArray;assertEquals(path,expected.length(),actual.length());repeat(expected.length()){equal(expected.get(it),actual.get(it),"$path[$it]")}}
            is Number->{assertTrue(path,actual is Number);assertEquals(path,expected.toDouble(),(actual as Number).toDouble(),0.0)}
            else->assertEquals(path,expected,actual)
        }
    }
    @Test fun allModelBranchesWeightedPositionsAndUvRotationsMatchTheSourceOnAndroid(){
        val reference=JSONObject(javaClass.getResourceAsStream("/native-resource-blocks-oracle.json")!!.bufferedReader().use{it.readText()})
        val cases=reference.getJSONArray("cases");assertEquals(95,cases.length());var comparisons=0
        repeat(cases.length()){i->val row=cases.getJSONObject(i);val name=row.getString("name")
            NativeResourceArchive.from(Base64.decode(row.getString("zip"),Base64.DEFAULT)).use{archive->val catalog=NativeResourceBlocks.prepare(archive)
                val expected=row.getJSONObject("expected")
                equal(expected.getJSONArray("blockStates"),JSONArray().also{a->catalog.blockStates.forEach{a.put(it.json())}},"$name.states")
                equal(expected.getJSONArray("models"),JSONArray().also{a->catalog.models.forEach{a.put(it.json())}},"$name.models")
                equal(expected.getJSONArray("issues"),JSONArray().also{a->catalog.issues.forEach{a.put(JSONObject().put("path",it.path).put("code",it.code))}},"$name.issues")
                equal(expected.getJSONArray("recognizedPaths"),JSONArray(catalog.recognizedPaths.sorted()),"$name.paths")
                val resolver=ResourceBlockResolver(catalog,NativeResourceTextures.prepare(archive));val queries=row.getJSONArray("resolutions")
                repeat(queries.length()){n->val q=queries.getJSONObject(n);val state=q.getJSONObject("state").let{v->v.keys().asSequence().associateWith{v.getString(it)}}
                    val pos=q.optJSONObject("position")?.let{ResourceBlockPosition(it.getDouble("x"),it.getDouble("y"),it.getDouble("z"))};val id=q.getString("blockId")
                    equal(q.getJSONObject("geometry"),resolver.geometry(id,state,pos).json(),"$name.geometry[$n]")
                    equal(q.getJSONObject("textures"),resolver.textures(id,state,pos).json(),"$name.textures[$n]");comparisons+=2
                }
            }
        }
        val rotations=reference.getJSONArray("rotations");assertEquals(768,rotations.length())
        repeat(rotations.length()){i->val r=rotations.getJSONObject(i);assertEquals(r.getInt("expected"),ResourceBlockResolver.faceTextureRotation(r.getString("face"),r.getInt("x"),r.getInt("y"),r.getBoolean("uvlock"),r.getInt("rotation")))}
        assertEquals(1554,comparisons)
        val result=JSONObject().put("schema",1).put("caseLabel",InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone")
            .put("cases",cases.length()).put("resolutionComparisons",comparisons).put("uvRotations",rotations.length()).put("sourceHashes",reference.getJSONObject("sourceHashes"))
        File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir,"p3-world-resource-models.json").writeText(result.toString())
    }
}
