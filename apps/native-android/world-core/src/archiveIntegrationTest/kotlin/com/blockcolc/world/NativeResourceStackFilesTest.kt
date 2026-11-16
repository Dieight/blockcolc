package com.blockcolc.world

import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class NativeResourceStackFilesTest {
    private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt()and 255)}
    private fun imageSha(image:ResourcePngImage)=MessageDigest.getInstance("SHA-256").also{it.update(image.rgba())}.digest().joinToString(""){"%02x".format(it.toInt()and 255)}
    private fun check(name:String,expected:JSONObject,stack:ResourcePackStack){
        assertTrue("$name pack",expected.getJSONObject("pack").similar(stack.pack.json()))
        val states=expected.getJSONArray("blockStates");val models=expected.getJSONArray("models")
        assertEquals("$name states",states.length(),stack.blocks.blockStates.size);assertEquals("$name models",models.length(),stack.blocks.models.size)
        repeat(states.length()){i->assertTrue("$name state $i",states.getJSONObject(i).similar(stack.blocks.blockStates[i].json()))}
        repeat(models.length()){i->assertTrue("$name model $i",models.getJSONObject(i).similar(stack.blocks.models[i].json()))}
        val summary=stack.summary();val issues=summary.getJSONArray("issues");repeat(issues.length()){issues.getJSONObject(it).remove("source")}
        assertTrue("$name summary: expected ${expected.getJSONObject("summary")} got $summary",expected.getJSONObject("summary").similar(summary))
        val textures=expected.getJSONArray("textures");assertEquals("$name textures",textures.length(),stack.textures.size)
        repeat(textures.length()){i->val row=textures.getJSONObject(i);val id=row.getString("resourceId");val got=stack.textures.getValue(id);val metadata=JSONObject(row.toString());metadata.remove("pngSha256")
            assertTrue("$name/$id metadata",metadata.similar(got.descriptor.json()));assertEquals("$name/$id owner PNG",row.getString("pngSha256"),sha(got.source.archive.read(got.descriptor.archivePath)))}
        val specials=expected.getJSONArray("specialTextures");assertEquals("$name special",specials.length(),stack.specialTextures.size)
        repeat(specials.length()){i->val row=specials.getJSONObject(i);val id=row.getString("resourceId");val value=stack.specialTextures.getValue(id);val metadata=JSONObject(row.toString());metadata.remove("rgbaSha256")
            assertTrue("$name/$id",metadata.similar(value.descriptor.json()));assertEquals("$name/$id RGBA",row.getString("rgbaSha256"),imageSha(value.decode()))}
        val maps=expected.getJSONArray("colormaps");assertEquals("$name colormaps",maps.length(),stack.colormaps.size)
        repeat(maps.length()){i->val row=maps.getJSONObject(i);val id=row.getString("resourceId");val value=stack.colormaps.getValue(id);val metadata=JSONObject(row.toString());metadata.remove("rgbaSha256")
            assertTrue("$name/$id",metadata.similar(value.descriptor.json()));assertEquals("$name/$id RGBA",row.getString("rgbaSha256"),imageSha(value.decode()))}
    }
    @Test fun realPacksInheritCurrentClientAssetsAndKeepTheExactEffectivePixelsAndModels(){
        val oracle=JSONObject(File(checkNotNull(System.getProperty("resourceStackFilesOracle"))).readText());val rows=oracle.getJSONArray("archives");assertEquals(5,rows.length())
        val opened=ArrayList<NativeResourceArchive>();val records=JSONArray()
        try{var base:ResourcePackStack?=null
            repeat(rows.length()){i->val row=rows.getJSONObject(i);val file=File(row.getString("path"));val start=System.nanoTime();val archive=NativeResourceArchive.open(file);opened+=archive
                assertEquals(row.getString("sha256"),archive.inputSha256);val assets=ResourcePackAssets.prepare(archive);val single=ResourcePackStack.of(assets)
                check(file.name,row.getJSONObject("expected"),single);var queries=0;var resolved=0;var count=single.textures.size
                if(base==null)base=single else{val stack=ResourcePackStack.layer(checkNotNull(base),assets);check(file.name+" layered",row.getJSONObject("layered"),stack);count=stack.textures.size
                    val resolver=stack.resolver();val cases=row.getJSONArray("queries");queries=cases.length()
                    repeat(cases.length()){n->val q=cases.getJSONObject(n);val id=q.getString("blockId");val state=q.getJSONObject("state").let{v->v.keys().asSequence().associateWith{v.getString(it)}}
                        val p=q.getJSONObject("position");val position=ResourceBlockPosition(p.getDouble("x"),p.getDouble("y"),p.getDouble("z"));val actual=resolver.geometry(id,state,position)
                        assertTrue("${file.name}/$id layered geometry",q.getJSONObject("geometry").similar(actual.json()));if(actual is ResourceBlockGeometry)resolved++}
                }
                records.put(JSONObject().put("name",file.name).put("singleTextures",single.textures.size).put("layeredTextures",count)
                    .put("specialTextures",single.specialTextures.size).put("colormaps",single.colormaps.size).put("queries",queries).put("resolvedGeometry",resolved)
                    .put("elapsedMs",(System.nanoTime()-start)/1e6))
            }
        }finally{opened.reversed().forEach{it.close()}}
        File(checkNotNull(System.getProperty("resourceStackResults"))).writeText(JSONObject().put("schema",1).put("passed",true).put("archives",records)
            .put("scope","Exact standalone and client-layered catalog/PNG ownership, all admitted special/colormap RGBA; one middle variant or combined multipart state per effective blockstate. CPU only.").toString(2))
    }
}
