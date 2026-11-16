package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.ReadOnlyBufferException
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class NativePrecipitationCompilerTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-precipitation-oracle.json")!!.readText())}
    private fun sha(bytes:ByteBuffer)=MessageDigest.getInstance("SHA-256").digest(ByteArray(bytes.remaining()).also{bytes.duplicate().get(it)}).joinToString(""){"%02x".format(it.toInt() and 255)}
    private fun surface(row:JSONObject)=TerrainSurface(row.getDouble("minX"),row.getDouble("maxX"),row.getDouble("minZ"),row.getDouble("maxZ"),row.getDouble("supportY"),
        when(row.getString("material")){"water"->TerrainMaterial.WATER;"grass"->TerrainMaterial.GRASS;else->TerrainMaterial.STONE})
    private fun ground()=NativePrecipitationGround.prepare(listOf(TerrainSurface(-16.0,16.0,-16.0,16.0,-.25,TerrainMaterial.WATER),
        TerrainSurface(-2.0,2.0,-2.0,2.0,4.5,TerrainMaterial.GRASS)))
    private fun context(preview:Boolean=false)=NativePrecipitationContext(listOf(-16.0,16.0,-16.0,16.0),listOf(20.0,20.0),ground(),preview)
    private fun weather(snow:Boolean)=NativeEnvironment.externalWeather("2026-10-26",NativeWeatherOverride(if(snow)NativeWeatherKind.SNOW else NativeWeatherKind.RAIN,
        precipitationIntensity=.3,visualPrecipitationIntensity=.65))
    private fun hashRows(source:NativePacketSource):String {
        val digest=MessageDigest.getInstance("SHA-256");val row=ByteBuffer.allocate(80).order(ByteOrder.LITTLE_ENDIAN);val world=checkNotNull(source.world)
        for(packet in world.packets){val rows=world.instanceRows(packet);repeat(packet.count){i->row.clear()
            repeat(16){row.putFloat(rows.getFloat(i*96+it*4))};repeat(4){row.putFloat(rows.getFloat(i*96+80+it*4))};digest.update(row.array())}}
        return digest.digest().joinToString(""){"%02x".format(it.toInt() and 255)}
    }
    private fun floats(array:JSONArray)=FloatArray(array.length()){array.getDouble(it).toFloat()}
    private fun floats(buffer:FloatBuffer)=FloatArray(buffer.remaining()).also{buffer.duplicate().get(it)}
    @Test fun terrainHeightPixelsAndNearestSamplesMatchTheActualFormalGroundRaster(){
        val cases=oracle.getJSONArray("grounds");assertEquals(6,cases.length())
        repeat(cases.length()){i->val expected=cases.getJSONObject(i);val rows=expected.getJSONArray("surfaces")
            val ground=NativePrecipitationGround.prepare(List(rows.length()){surface(rows.getJSONObject(it))})
            assertEquals(expected.getInt("width"),ground.texture.width);assertEquals(expected.getInt("height"),ground.texture.height)
            for((key,value)in listOf("minX" to ground.minX,"minZ" to ground.minZ,"spanX" to ground.spanX,"spanZ" to ground.spanZ,"minY" to ground.minY,"maxY" to ground.maxY))assertEquals(key,expected.getDouble(key),value,0.0)
            assertEquals("ground $i",expected.getString("sha256"),sha(ground.texture.bytes()))
            val samples=expected.getJSONArray("samples");repeat(samples.length()){j->val sample=samples.getJSONObject(j)
                assertEquals(sample.getDouble("y"),ground.at(sample.getDouble("x"),sample.getDouble("z")).toDouble(),0.0)}
        }
        val invalid=listOf(TerrainSurface(0.0,0.0,0.0,1.0,8.0,TerrainMaterial.GRASS),TerrainSurface(Double.NaN,1.0,0.0,1.0,8.0,TerrainMaterial.GRASS))
        assertEquals(1,NativePrecipitationGround.prepare(invalid).texture.width)
        assertEquals(4.5,ground().at(0.0,0.0).toDouble(),0.0);assertEquals(-.25,ground().at(12.0,12.0).toDouble(),0.0)
        assertThrows(CancellationException::class.java){NativePrecipitationGround.prepare(invalid,cancelled={true})}
    }
    @Test fun heightTexturesAreImmutableLinearFloatDataWithDimensionsInTheirGpuIdentity(){
        val pixels=ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putFloat(-.25f).putFloat(4.5f).flip()
        val tall=NativeGroundTexture(1,2,pixels);val wide=NativeGroundTexture(2,1,pixels)
        assertEquals(tall.sha256,wide.sha256);assertNotEquals(tall.identity,wide.identity)
        pixels.putFloat(0,100f);assertEquals(-.25f,tall.heights.at(0.0,0.0),0f)
        assertThrows(ReadOnlyBufferException::class.java){tall.bytes().putFloat(0,0f)}
        val metadata=tall.metadata(0);assertEquals("r32f-le",metadata.getString("encoding"));assertEquals("",metadata.getString("colorSpace"));assertFalse(metadata.getBoolean("generateMipmaps"))
        assertEquals(8L,tall.gpuBytes)
        assertThrows(IllegalArgumentException::class.java){NativeGroundTexture(1,1,ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putFloat(Float.NaN).flip())}
    }
    @Test fun rainCylinderAndSnowBoxMatchThePinnedThreeGeometryAttributes(){
        val cases=oracle.getJSONArray("geometry");assertEquals(8,cases.length())
        repeat(cases.length()){i->val expected=cases.getJSONObject(i);val actual=NativePrecipitationGeometry.create(expected.getBoolean("snow"),expected.getDouble("visual"))
            assertArrayEquals("positions $i",floats(expected.getJSONArray("position")),floats(actual.positions()),0f)
            assertArrayEquals("normals $i",floats(expected.getJSONArray("normal")),floats(actual.normals()),0f)
            assertArrayEquals("uv $i",floats(expected.getJSONArray("uv")),floats(checkNotNull(actual.textureCoordinates())),0f)
            if(expected.isNull("index"))assertNull(actual.indices())else{
                val indices=expected.getJSONArray("index");val buffer=checkNotNull(actual.indices());val values=IntArray(buffer.remaining());buffer.get(values)
                assertArrayEquals(IntArray(indices.length()){indices.getInt(it)},values)
            }
        }
    }
    @Test fun completeParticleCapacityMatchesTheUnmodifiedFormalSeedLoopsIncludingZeroRandomTail(){
        val cases=oracle.getJSONArray("seeds");assertEquals(16,cases.length())
        repeat(cases.length()){i->val expected=cases.getJSONObject(i);val context=context(expected.getBoolean("preview"));val compiler=NativePrecipitationCompiler()
            val prepared=compiler.prepare(context,weather(expected.getBoolean("snow")),.72,expected.getLong("tail"))
            assertEquals(expected.getInt("count"),prepared.capacity);assertEquals(expected.getString("sha256"),hashRows(prepared.source))
            assertEquals(prepared.capacity,prepared.source.world!!.packets.sumOf{it.count})
            assertTrue(prepared.source.world.packets.all{it.layer=="precipitation"&&it.auxChannels==listOf("weatherPhase","weatherOffset")&&!it.castShadow&&!it.receiveShadow&&it.lod==null})
            val sample=NativeEnvironmentContext("UTC",NativeLightingQuality.HIGH,20.0,16.0,30.0).sample(1_792_886_400_000L)
            prepared.source.validateRuntime(sample.uniforms());compiler.clear()
        }
    }
    @Test fun workerIdentitiesCacheAndCancellationDoNotDependOnTheRetainedCpuMesh(){
        val context=context();val w=weather(false);val compiler=NativePrecipitationCompiler();val before=compiler.prepare(context,w,.45,0L)
        assertSame(before,compiler.prepare(context,w,.45,0L))
        val other=NativePrecipitationCompiler().prepare(context,w,.45,0L)
        assertNotSame(before.source,other.source);assertEquals(before.source.ownerIdentity,other.source.ownerIdentity)
        var checks=0;assertThrows(CancellationException::class.java){compiler.prepare(context,w,.45,1L,cancelled={++checks>8})}
        assertSame(before,compiler.prepare(context,w,.45,0L))
        assertNotEquals(before.key,NativePrecipitationCompiler.key(context,w,.72,0L))
        assertNotEquals(before.key,NativePrecipitationCompiler.key(context,w,.45,1L))
        val bounds=mutableListOf(-16.0,16.0,-16.0,16.0);val copied=NativePrecipitationContext(bounds,listOf(20.0,20.0),context.ground)
        bounds[0]=Double.NaN;assertEquals(context.identity,copied.identity)
        assertThrows(UnsupportedOperationException::class.java){(copied.bounds as MutableList).clear()}
        val clear=NativeEnvironment.externalWeather("2026-10-26",NativeWeatherOverride(NativeWeatherKind.CLEAR))
        val absent=compiler.prepare(context,clear,1.0,1L);assertEquals(0,absent.capacity);assertNull(absent.source.world);assertNull(absent.source.precipitation)
        assertEquals(PacketOwners.PRECIPITATION,absent.source.owner);assertEquals(0L,absent.source.footprint.textureBytes)
        compiler.clear()
    }
    @Test fun runtimeRejectsMissingGroundTruncatedCapacityAndMutableOrInvalidDescriptors(){
        val c=context(true);val prepared=NativePrecipitationCompiler().prepare(c,weather(false),1.0,1L);val source=prepared.source
        val sample=NativeEnvironmentContext("UTC",NativeLightingQuality.HIGH,20.0,16.0,30.0).sample(1_792_886_400_000L)
        val missing=NativePacketSource(source.owner,source.world,emptyList(),source.surfaces,layer=NativePacketLayer.PRECIPITATION,precipitationKey=prepared.key)
        assertThrows(IllegalArgumentException::class.java){missing.validateRuntime(sample.uniforms())}
        val runtime=checkNotNull(source.precipitation);val builder=NativePacketBuilder(source.owner,NativePacketLayer.PRECIPITATION,precipitation=runtime,precipitationKey=prepared.key)
        val material=NativeRenderMaterial(unlit=true,transparent=true,depthWrite=false,fog=false,surface=source.surfaces.single())
        builder.add(NativePrecipitationGeometry.create(false,.65),material,FloatBuffer.wrap(FloatArray(16){if(it in listOf(0,5,10,15))1f else 0f}),
            aux=FloatBuffer.wrap(floatArrayOf(0f,0f,0f,0f)),castShadow=false,receiveShadow=false)
        assertThrows(IllegalArgumentException::class.java){builder.build()}
        val mutable=mutableListOf(0.0,0.0);val raw=source.surfaces.single().copy(optics=SurfaceOptics(precipitation=runtime.descriptor.copy(center=mutable)))
        val frozen=raw.immutableNative();mutable[0]=Double.NaN;assertEquals(listOf(0.0,0.0),frozen.optics.precipitation!!.center)
        assertThrows(UnsupportedOperationException::class.java){(frozen.optics.precipitation!!.center as MutableList).clear()}
        assertThrows(IllegalArgumentException::class.java){raw.immutableNative()}
        assertThrows(IllegalArgumentException::class.java){source.surfaces.single().copy(optics=SurfaceOptics(precipitation=runtime.descriptor.copy(span=Double.NaN))).immutableNative()}
    }
}
