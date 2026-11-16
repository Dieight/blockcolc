package com.blockcolc.world

import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.FloatBuffer
import java.security.MessageDigest
import java.util.Base64

class NativeAtlasPacketsTest {
    private val reference by lazy{JSONObject(javaClass.getResource("/native-atlas-programs-oracle.json")!!.readText())}
    private fun sha(input:ByteBuffer)=MessageDigest.getInstance("SHA-256").also{it.update(input)}.digest().joinToString(""){"%02x".format(it.toInt()and 255)}
    private fun options(o:JSONObject)=ResourceAtlasLimits(o.optInt("maxTextures",4096),o.optInt("maxPageSize",2048),o.optInt("maxPages",4),o.optInt("gutter",2),o.optInt("maxPngBytes",4194304),o.optInt("maxSourcePixelsPerTexture",1048576),o.optLong("maxDecodedBytes",134217728),o.optLong("reservedAtlasBytes",0),o.optLong("additionalWorkingSetBytes",0))
    private fun <T> prepared(row:JSONObject,block:(ResourceTextureAtlas,NativeAtlasTextures)->T):T=NativeResourceArchive.from(Base64.getDecoder().decode(row.getString("zip"))).use{archive->
        val stack=ResourcePackStack.of(ResourcePackAssets.prepare(archive));val selected=row.optJSONArray("selectedIds")?.let{v->List(v.length()){v.getString(it)}.toSet()}
        val atlas=NativeResourceAtlas.build(stack,selected,options(row.getJSONObject("limits")));block(atlas,NativeAtlasTextures.prepare(atlas))}
    @Test fun referenceComesFromActualMipAndAnimationImplementations(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/resource-textures.ts").isFile};val hashes=reference.getJSONObject("sourceHashes")
        assertTrue(hashes.has("packages/voxel/src/resource-textures.ts"));assertTrue(hashes.has("packages/voxel/src/atlas-animation.ts"))
        hashes.keys().forEach{p->assertEquals(p,hashes.getString(p),sha(ByteBuffer.wrap(File(root,p).readBytes())))}
    }
    @Test fun alphaWeightedSafeMipsAndEveryAnimationSampleMatchTheActualThreeSource(){
        val cases=reference.getJSONArray("cases");assertTrue(cases.length()>20)
        repeat(cases.length()){i->val row=cases.getJSONObject(i);prepared(row){atlas,textures->val bindings=textures.forOwner("building:sample");val pages=row.getJSONArray("pages");assertEquals(pages.length(),bindings.size)
            repeat(pages.length()){n->val p=pages.getJSONObject(n);val binding=bindings.getValue(p.getInt("page"));val levels=p.getJSONArray("levels")
                assertEquals(row.getString("name"),levels.length(),binding.color.manualMipmaps.size+1);assertEquals(levels.getJSONObject(0).getString("sha256"),binding.color.sha256)
                repeat(levels.length()-1){j->val e=levels.getJSONObject(j+1);val got=binding.color.manualMipmaps[j];assertEquals(e.getInt("width"),got.width);assertEquals(e.getInt("height"),got.height);assertEquals(e.getString("sha256"),got.sha256)}
                if(p.has("animation")){val a=p.getJSONObject("animation");assertTrue(binding.animated);assertEquals(a.getString("identity"),binding.identity)
                    val schedule=binding.schedule(1,2);val timeline=schedule.timeline();assertEquals(a.getInt("tileCount"),timeline.tileCount);assertEquals(a.getInt("width"),timeline.width);assertEquals(a.getInt("height"),timeline.height)
                    val samples=a.getJSONArray("samples");repeat(samples.length()){j->val e=samples.getJSONObject(j);timeline.sample(e.getDouble("time"));assertEquals(e.getString("frames"),sha(ByteBuffer.wrap(timeline.pixels)));assertEquals(e.getString("blends"),sha(ByteBuffer.wrap(timeline.blendPixels)))}
                    timeline.sample(9999.0,true);assertEquals(a.getJSONObject("frozen").getString("frames"),sha(ByteBuffer.wrap(timeline.pixels)));assertEquals(a.getJSONObject("frozen").getString("blends"),sha(ByteBuffer.wrap(timeline.blendPixels)))
                }else{assertFalse(binding.animated);assertNull(binding.frames);assertNull(binding.blends);assertFalse(binding.source(0,null,null).animated)}
            };assertTrue(atlas.pages.isEmpty()||textures.estimatedPeakBytes<=atlas.memoryEstimate.getValue("limitBytes"))
        }}
    }
    @Test fun ownerTablesAndTimelineStateAreSeparateWhileColorPagesStayShared(){
        val rows=reference.getJSONArray("cases");val row=(0 until rows.length()).map{rows.getJSONObject(it)}.first{it.getString("name")=="strip-animation"}
        prepared(row){_,textures->val a=textures.forOwner("building:a").values.single();val b=textures.forOwner("building:b").values.single();val inactive=textures.forOwner("building:a",emptySet()).values.single()
            assertSame(a.color,b.color);assertNotEquals(a.frames!!.identity,b.frames!!.identity);assertFalse(inactive.animated)
            val one=a.schedule(1,2).timeline();val two=a.schedule(1,2).timeline();val before=two.pixels.copyOf();one.sample(999.0);assertArrayEquals(before,two.pixels)
            assertThrows(UnsupportedOperationException::class.java){(a.color.manualMipmaps as MutableList).clear()}
            assertThrows(java.nio.ReadOnlyBufferException::class.java){a.color.manualMipmaps.first().pixels().put(0,0.toByte())}
        }
    }
    @Test fun preparedGeometryTagLookupTablesFootprintAndEnvironmentReachThePacketBoundary(){
        val rows=reference.getJSONArray("cases");val row=(0 until rows.length()).map{rows.getJSONObject(it)}.first{it.getString("name")=="strip-animation"}
        prepared(row){_,textures->val binding=textures.forOwner("building:sample").values.single();val cube=CuboidGeometry.create()
            val geometry=object:BlockGeometry by cube{override val vertexPreparation="atlas-static-v1";override fun colors()=FloatBuffer.wrap(FloatArray(vertexCount*3){1f});override fun colorAlpha()=FloatBuffer.wrap(FloatArray(vertexCount){(it%6).toFloat()})}
            val surface=NativeSurfaceBinding(.01f);val state=NativeSurfaceState();val material=NativeRenderMaterial(texture=binding.color,vertexColors=true,atlas=binding,surface=surface.resolve(state),environment=NativeMaterialBinding(surface))
            val matrices=FloatBuffer.wrap(FloatArray(16){if(it in listOf(0,5,10,15))1f else 0f});val builder=NativePacketBuilder("building:sample");builder.add(geometry,material,matrices)
            val source=builder.build();assertEquals(3,source.textures.size);assertEquals(1,source.atlasSchedules.size);assertEquals("atlas-static-v1",source.world!!.geometries.single().vertexPreparation)
            val optics=source.surfaces.single().optics.atlas!!;assertTrue(optics.animated);assertEquals(1,optics.lookup);assertEquals(2,optics.blend)
            source.validateRuntime(NativeEnvironmentContext("UTC",NativeLightingQuality.HIGH,8.0,64.0,30.0).sample(1792828800000).uniforms())
            assertEquals(source.textures.sumOf{it.gpuBytes},source.footprint.textureBytes)
            assertThrows(IllegalArgumentException::class.java){NativePacketBuilder("building:other").add(geometry,material,matrices)}
            assertThrows(IllegalArgumentException::class.java){NativePacketBuilder("building:sample").add(cube,material,matrices)}
        }
    }
}
