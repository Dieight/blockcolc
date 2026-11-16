package com.blockcolc.world

import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class NativeResourceBlockFilesTest {
    @Test fun allActualPackModelsAndBlockStatesAndSelectedVariantsMatchTheSource(){
        val reference=JSONObject(File(checkNotNull(System.getProperty("resourceBlockFilesOracle"))).readText());val archives=reference.getJSONArray("archives");val records=JSONArray()
        repeat(archives.length()){index->val row=archives.getJSONObject(index);val file=File(row.getString("path"));val start=System.nanoTime()
            NativeResourceArchive.open(file).use{archive->assertEquals(row.getString("sha256"),archive.inputSha256)
                val catalog=NativeResourceBlocks.prepare(archive);val textures=NativeResourceTextures.prepare(archive);val indexed=System.nanoTime()
                val expected=row.getJSONObject("expected");val states=expected.getJSONArray("blockStates");val models=expected.getJSONArray("models")
                assertEquals(file.name+" blockstates",states.length(),catalog.blockStates.size);assertEquals(file.name+" models",models.length(),catalog.models.size)
                repeat(states.length()){i->val e=states.getJSONObject(i);assertTrue(file.name+"/"+e.getString("resourceId"),e.similar(catalog.blockStates[i].json()))}
                repeat(models.length()){i->val e=models.getJSONObject(i);assertTrue(file.name+"/"+e.getString("resourceId"),e.similar(catalog.models[i].json()))}
                val issues=JSONArray().also{a->catalog.issues.forEach{a.put(JSONObject().put("path",it.path).put("code",it.code))}}
                assertTrue(file.name+" issues",expected.getJSONArray("issues").similar(issues))
                val resolver=ResourceBlockResolver(catalog,textures);val queries=row.getJSONArray("resolutions");var resolvedGeometry=0;var resolvedCube=0
                repeat(queries.length()){i->val q=queries.getJSONObject(i);val id=q.getString("blockId");val state=q.getJSONObject("state").let{v->v.keys().asSequence().associateWith{v.getString(it)}}
                    val p=q.getJSONObject("position");val position=ResourceBlockPosition(p.getDouble("x"),p.getDouble("y"),p.getDouble("z"))
                    val geometry=resolver.geometry(id,state,position);val cube=resolver.textures(id,state,position)
                    assertTrue("${file.name}/$id geometry $state",q.getJSONObject("geometry").similar(geometry.json()))
                    assertTrue("${file.name}/$id textures $state",q.getJSONObject("textures").similar(cube.json()))
                    if(geometry is ResourceBlockGeometry)resolvedGeometry++;if(cube is ResourceBlockTextures)resolvedCube++
                }
                records.put(JSONObject().put("name",file.name).put("states",states.length()).put("models",models.length()).put("issues",issues.length())
                    .put("queries",queries.length()).put("resolvedGeometry",resolvedGeometry).put("resolvedCube",resolvedCube)
                    .put("indexedMs",(indexed-start)/1e6).put("resolvedAndVerifiedMs",(System.nanoTime()-indexed)/1e6))
            }
        }
        File(checkNotNull(System.getProperty("resourceBlockResults"))).writeText(JSONObject().put("schema",1).put("passed",true).put("archives",records)
            .put("scope","All normalized models and states; first, middle and last variants per blockstate or one combined multipart state. Synthetic oracle covers additional selector and malformed-input branches; no GPU or Android performance acceptance.").toString(2))
    }
}
