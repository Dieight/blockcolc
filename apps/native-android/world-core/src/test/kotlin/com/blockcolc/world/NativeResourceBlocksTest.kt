package com.blockcolc.world

import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.CancellationException

class NativeResourceBlocksTest {
    private val reference by lazy{JSONObject(javaClass.getResource("/native-resource-blocks-oracle.json")!!.readText())}
    private fun input(row:JSONObject)=Base64.getDecoder().decode(row.getString("zip"))
    private fun result(catalog:ResourceBlockCatalog)=JSONObject().put("blockStates",JSONArray().also{a->catalog.blockStates.forEach{a.put(it.json())}})
        .put("models",JSONArray().also{a->catalog.models.forEach{a.put(it.json())}}).put("issues",JSONArray().also{a->catalog.issues.forEach{a.put(JSONObject().put("path",it.path).put("code",it.code))}})
        .put("recognizedPaths",JSONArray(catalog.recognizedPaths.sorted()))
    private fun position(row:JSONObject)=row.optJSONObject("position")?.let{ResourceBlockPosition(it.getDouble("x"),it.getDouble("y"),it.getDouble("z"))}
    private fun state(row:JSONObject)=row.getJSONObject("state").let{v->v.keys().asSequence().associateWith{v.getString(it)}}
    private fun assertJson(name:String,expected:JSONObject,actual:JSONObject){
        assertTrue("$name\nexpected: $expected\nactual: $actual",expected.similar(actual))
    }
    @Test fun referenceIsBoundToTheActualCurrentParser(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/resource-pack/src/block-models.ts").isFile}
        val hashes=reference.getJSONObject("sourceHashes");assertTrue(hashes.has("packages/resource-pack/src/block-models.ts"))
        hashes.keys().forEach{p->val hash=MessageDigest.getInstance("SHA-256").digest(File(root,p).readBytes()).joinToString(""){"%02x".format(it.toInt()and 255)};assertEquals(p,hashes.getString(p),hash)}
    }
    @Test fun everyBlockStateModelElementAndIssueMatchesTheFormalParser(){
        val cases=reference.getJSONArray("cases");assertTrue(cases.length()>80)
        repeat(cases.length()){i->val row=cases.getJSONObject(i);NativeResourceArchive.from(input(row)).use{archive->
            assertJson(row.getString("name"),row.getJSONObject("expected"),result(NativeResourceBlocks.prepare(archive)))
        }}
    }
    @Test fun fullModelInheritanceMultipartWeightedChoicesAndFallbacksMatchTheSource(){
        val cases=reference.getJSONArray("cases");var comparisons=0
        repeat(cases.length()){i->val row=cases.getJSONObject(i);NativeResourceArchive.from(input(row)).use{archive->
            val resolver=ResourceBlockResolver(NativeResourceBlocks.prepare(archive),NativeResourceTextures.prepare(archive));val queries=row.getJSONArray("resolutions")
            repeat(queries.length()){n->val q=queries.getJSONObject(n);val id=q.getString("blockId");val values=state(q);val p=position(q);val name=row.getString("name")+"/$n"
                assertJson("$name geometry",q.getJSONObject("geometry"),resolver.geometry(id,values,p).json())
                assertJson("$name textures",q.getJSONObject("textures"),resolver.textures(id,values,p).json());comparisons+=2
            }
        }};assertTrue(comparisons>1400)
    }
    @Test fun everyFaceQuarterTurnAndUvLockMatchesTheSource(){
        val rows=reference.getJSONArray("rotations");assertEquals(768,rows.length())
        repeat(rows.length()){i->val row=rows.getJSONObject(i);assertEquals(row.toString(),row.getInt("expected"),ResourceBlockResolver.faceTextureRotation(row.getString("face"),row.getInt("x"),row.getInt("y"),row.getBoolean("uvlock"),row.getInt("rotation")))}
    }
    @Test fun publishedModelsAndTheirNestedPropertiesCannotBeMutated(){
        val row=reference.getJSONArray("cases").getJSONObject(0)
        NativeResourceArchive.from(input(row)).use{archive->val catalog=NativeResourceBlocks.prepare(archive);val before=result(catalog).toString()
            assertThrows(UnsupportedOperationException::class.java){(catalog.models as MutableList).clear()}
            assertThrows(UnsupportedOperationException::class.java){(catalog.models.first().textures as MutableMap).clear()}
            assertThrows(UnsupportedOperationException::class.java){(catalog.models.first().elements!!.first().faces as MutableMap).clear()}
            assertThrows(UnsupportedOperationException::class.java){(catalog.blockStates.first().variants.first().choices as MutableList).clear()}
            catalog.models.first().json().put("parent","mutated");assertEquals(before,result(catalog).toString())
            assertThrows(CancellationException::class.java){NativeResourceBlocks.prepare(archive){true}}
            val resolver=ResourceBlockResolver(catalog,NativeResourceTextures.prepare(archive))
            assertThrows(CancellationException::class.java){resolver.geometry("minecraft:test"){true}}
            assertThrows(CancellationException::class.java){resolver.textures("minecraft:test"){true}}
        }
    }
    @Test fun catalogsCannotMixDifferentOwnedArchives(){
        val rows=reference.getJSONArray("cases")
        NativeResourceArchive.from(input(rows.getJSONObject(0))).use{a->NativeResourceArchive.from(input(rows.getJSONObject(1))).use{b->
            assertThrows(IllegalArgumentException::class.java){ResourceBlockResolver(NativeResourceBlocks.prepare(a),NativeResourceTextures.prepare(b))}
        }}
    }
}
