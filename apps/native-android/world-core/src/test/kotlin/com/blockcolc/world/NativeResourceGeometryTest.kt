package com.blockcolc.world

import com.blockcolc.world.resource.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.CancellationException

class NativeResourceGeometryTest{
    private val reference by lazy{JSONObject(javaClass.getResource("/native-resource-geometry-oracle.json")!!.readText())}
    private val rows get()=reference.getJSONArray("cases")
    private fun state(o:JSONObject):Map<String,String> = o.keys().asSequence().associateWith{o.getString(it)}
    private fun <T> prepared(row:JSONObject,block:(ResourcePackStack,ResourceTextureAtlas)->T):T=
        NativeResourceArchive.from(Base64.getDecoder().decode(row.getString("zip"))).use{archive->
            val stack=ResourcePackStack.of(ResourcePackAssets.prepare(archive));block(stack,NativeResourceAtlas.build(stack))}
    private fun compile(stack:ResourcePackStack,atlas:ResourceTextureAtlas,q:JSONObject):NativeResourceModelResult{
        val id=q.getString("blockId");val s=state(q.getJSONObject("state"));val p=q.optJSONObject("position")?.let{ResourceBlockPosition(it.getDouble("x"),it.getDouble("y"),it.getDouble("z"))}
        val mapped=NativeResourceAtlasMapping.geometry(stack.resolver().geometry(id,s,p),atlas)
        return NativeResourceGeometry.compile(id,s,mapped,atlas,ResourceBiomePalette.from(stack))
    }
    @Test fun referenceUsesTheActualMappedGeometryAndAtlasPreparation(){
        val hashes=reference.getJSONObject("sourceHashes");assertTrue(hashes.has("packages/voxel/src/resource-geometry.ts"));assertTrue(hashes.has("apps/native-android/tools/atlas-source.mjs"))
        for(p in hashes.keys()){val bytes=File("../../../$p").readBytes();val hash=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt()and 255)};assertEquals(p,hashes.getString(p),hash)}
    }
    @Test fun mappedFacesTransformsUvsTintShadeAndFallbacksMatchTheFormalRenderer(){
        var comparisons=0;var accepted=0
        repeat(rows.length()){i->val row=rows.getJSONObject(i);prepared(row){stack,atlas->
            val queries=row.getJSONArray("queries");repeat(queries.length()){j->val q=queries.getJSONObject(j);val label="${row.getString("name")}:$j";val e=q.getJSONObject("expected");val actual=compile(stack,atlas,q)
                comparisons++
                if(e.has("fallback")){assertTrue(label,actual is NativeResourceModelResult.Fallback);if(e.getString("fallback")!="UNCOMPILED")assertEquals(label,e.getString("fallback"),(actual as NativeResourceModelResult.Fallback).reason)}
                else{accepted++;assertTrue(label,actual is NativeResourceModelResult.Model);val parts=(actual as NativeResourceModelResult.Model).parts;val expected=e.getJSONArray("parts");assertEquals(label,expected.length(),parts.size)
                    for(k in parts.indices){val a=parts[k];val r=expected.getJSONObject(k);val g=a.geometry
                        assertEquals(label,r.getInt("page"),a.page);assertEquals(label,r.getString("alphaMode"),a.alphaMode)
                        assertEquals("atlas-static-v1",g.vertexPreparation);assertTrue(g.positions().isReadOnly);assertTrue(g.colors()!!.isReadOnly)
                        val p=g.positions();val n=g.normals();val uv=g.textureCoordinates()!!;val c=g.colors()!!;val alpha=g.colorAlpha()!!;val ix=g.indices()!!
                        val values=r.getJSONArray("vertex");assertEquals(label,values.length(),g.vertexCount*12)
                        repeat(g.vertexCount){v->val array=FloatArray(12){axis->when(axis){in 0..2->p.get(v*3+axis);in 3..5->n.get(v*3+axis-3);in 6..7->uv.get(v*2+axis-6);in 8..10->c.get(v*3+axis-8);else->alpha.get(v)}}
                            for(axis in 0..11)assertEquals("$label part$k vertex$v channel$axis",values.getDouble(v*12+axis),array[axis].toDouble(),1e-7)}
                        val indices=r.getJSONArray("indices");assertEquals(label,indices.length(),ix.remaining());repeat(ix.remaining()){v->assertEquals(label,indices.getInt(v),ix.get(v))}
                    }
                }
            }
        }}
        assertEquals(904,comparisons);assertEquals(704,accepted)
    }
    @Test fun colormapSamplesMatchTheFixedClimateAndClamping(){
        val cases=reference.getJSONArray("paletteSamples");repeat(cases.length()){i->val row=cases.getJSONObject(i);val maps=row.getJSONArray("maps")
            repeat(maps.length()){j->val m=maps.getJSONObject(j);val image=ResourcePngImage(256,256,Base64.getDecoder().decode(m.getString("rgba")))
                val kind=if(m.getString("kind")=="dry_foliage")"dryFoliage"else m.getString("kind")
                assertEquals(row.getJSONObject("expected").getInt(kind),ResourceBiomePalette.sample(image,row.getDouble("temperature"),row.getDouble("downfall")))}}
        assertThrows(IllegalArgumentException::class.java){ResourceBiomePalette.sample(ResourcePngImage(16,16,ByteArray(1024)))}
    }
    @Test fun cancellationAndWrongAtlasCannotPublishACompiledModel(){
        val row=rows.getJSONObject(0);prepared(row){stack,atlas->val id="minecraft:test";val mapped=NativeResourceAtlasMapping.geometry(stack.resolver().geometry(id),atlas)
            assertThrows(CancellationException::class.java){NativeResourceGeometry.compile(id,emptyMap(),mapped,atlas,cancelled={true})}
            val other=NativeResourceAtlas.build(stack);assertThrows(IllegalArgumentException::class.java){NativeResourceGeometry.compile(id,emptyMap(),mapped,other)}
        }
    }
}
