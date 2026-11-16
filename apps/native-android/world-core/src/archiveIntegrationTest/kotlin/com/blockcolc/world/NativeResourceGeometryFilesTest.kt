package com.blockcolc.world

import com.blockcolc.world.resource.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class NativeResourceGeometryFilesTest{
    @Test fun currentClientAndFourLayeredUserPacksCompileTheSameSelectedModels(){
        val oracle=JSONObject(File(checkNotNull(System.getProperty("resourceGeometryFilesOracle"))).readText());val rows=oracle.getJSONArray("archives");assertEquals(5,rows.length())
        val opened=ArrayList<NativeResourceArchive>();val records=JSONArray();var base:ResourcePackStack?=null
        try{repeat(rows.length()){i->val row=rows.getJSONObject(i);val file=File(row.getString("path"));val archive=NativeResourceArchive.open(file);opened+=archive
            assertEquals(row.getString("sha256"),archive.inputSha256);val current=ResourcePackAssets.prepare(archive)
            val stack=if(base==null)ResourcePackStack.of(current).also{base=it}else ResourcePackStack.layer(checkNotNull(base),current)
            val atlas=NativeResourceAtlas.build(stack);val palette=ResourceBiomePalette.from(stack)
            val textures=NativeAtlasTextures.prepare(atlas);assertTrue(textures.estimatedPeakBytes<=134217728)
            val bindings=textures.forOwner("building:real-pack");assertEquals(atlas.pages.size,bindings.size)
            assertTrue(bindings.values.all{it.color.width==it.page.width&&it.color.height==it.page.height})
            assertEquals(row.getInt("atlasEntries"),atlas.entries.size);val p=row.getJSONObject("palette")
            for((name,value)in listOf("grass" to palette.grass,"foliage" to palette.foliage,"dryFoliage" to palette.dryFoliage,"water" to palette.water,"spruceLeaves" to palette.spruceLeaves,"birchLeaves" to palette.birchLeaves,"lilyPad" to palette.lilyPad))assertEquals("${file.name} $name",p.getInt(name),value)
            val resolver=stack.resolver();val queries=row.getJSONArray("queries");var accepted=0;var vertices=0L;var faces=0L
            val reasons=LinkedHashMap<String,Int>()
            repeat(queries.length()){j->val q=queries.getJSONObject(j);val id=q.getString("blockId");val state=q.getJSONObject("state").let{s->s.keys().asSequence().associateWith{s.getString(it)}}
                val pos=q.getJSONObject("position").let{ResourceBlockPosition(it.getDouble("x"),it.getDouble("y"),it.getDouble("z"))}
                val actual=NativeResourceGeometry.compile(id,state,NativeResourceAtlasMapping.geometry(resolver.geometry(id,state,pos),atlas),atlas,palette)
                val e=q.getJSONObject("expected");val label="${file.name}/$id query$j"
                if(e.has("fallback")){assertTrue(label,actual is NativeResourceModelResult.Fallback);actual as NativeResourceModelResult.Fallback
                    if(e.getString("fallback")!="UNCOMPILED")assertEquals(label,e.getString("fallback"),actual.reason);reasons[actual.reason]=(reasons[actual.reason]?:0)+1}
                else{accepted++;assertTrue(label,actual is NativeResourceModelResult.Model);val expected=e.getJSONArray("parts");val parts=(actual as NativeResourceModelResult.Model).parts
                    assertEquals(label,expected.length(),parts.size)
                    for(k in parts.indices){val part=parts[k];val wanted=expected.getJSONObject(k);val g=part.geometry;assertEquals(label,wanted.getInt("page"),part.page);assertEquals(label,wanted.getString("alphaMode"),part.alphaMode)
                        val values=wanted.getJSONArray("vertex");assertEquals(label,values.length(),g.vertexCount*12);vertices+=g.vertexCount;faces+=g.vertexCount/4
                        val position=g.positions();val normal=g.normals();val uv=g.textureCoordinates()!!;val rgb=g.colors()!!;val alpha=g.colorAlpha()!!
                        repeat(g.vertexCount){v->for(axis in 0..11){val n=when(axis){in 0..2->position.get(v*3+axis);in 3..5->normal.get(v*3+axis-3);in 6..7->uv.get(v*2+axis-6);in 8..10->rgb.get(v*3+axis-8);else->alpha.get(v)}
                            assertEquals("$label part$k vertex$v channel$axis",values.getDouble(v*12+axis),n.toDouble(),1e-7)}}
                        val indices=g.indices()!!;val wantedIndices=wanted.getJSONArray("indices");assertEquals(label,wantedIndices.length(),indices.remaining());repeat(indices.remaining()){v->assertEquals(label,wantedIndices.getInt(v),indices.get(v))}
                    }
                }
            }
            records.put(JSONObject().put("name",file.name).put("queries",queries.length()).put("models",accepted).put("fallbacks",queries.length()-accepted)
                .put("fallbackReasons",JSONObject(reasons)).put("vertices",vertices).put("faces",faces).put("atlasEntries",atlas.entries.size)
                .put("nativeEstimatedPeakBytes",textures.estimatedPeakBytes).put("nativeColorPages",bindings.size).put("nativeAnimatedPages",bindings.values.count{it.animated}))
        }}finally{opened.reversed().forEach{it.close()}}
        File(checkNotNull(System.getProperty("resourceGeometryResults"))).writeText(JSONObject().put("schema",1).put("passed",true).put("archives",records)
            .put("scope","Local JVM selected-state geometry, all emitted vertex attributes and indices, palette and exact fallback parity. Not all states, actual GPU visuals or mobile performance.").toString(2))
    }
}
