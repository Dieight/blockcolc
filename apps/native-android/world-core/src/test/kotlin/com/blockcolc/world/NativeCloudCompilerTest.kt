package com.blockcolc.world

import com.blockcolc.world.generation.CuboidGeometry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class NativeCloudCompilerTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-cloud-oracle.json")!!.readText())}
    private fun weather(c:JSONObject):NativeWeather {val w=c.getJSONObject("weather");val kind=NativeWeatherKind.entries.single{it.wire==w.getString("kind")}
        return NativeEnvironment.externalWeather("2026-10-26",NativeWeatherOverride(kind,w.getBoolean("thunderstorm"),w.getDouble("cloudIntensity")))
            .copy(seed=c.getLong("seed"),cloudCount=c.getJSONObject("input").getInt("weatherCloudCount"))}
    private fun context(c:JSONObject):NativeCloudContext {val v=c.getJSONObject("input");val b=c.getJSONObject("budget");val p=c.getJSONObject("context")
        return NativeCloudContext(NativeCloudView(v.getDouble("contentWidth"),v.getDouble("contentDepth"),v.getDouble("visibleWidth"),v.getDouble("visibleDepth"),
            v.optDouble("normalWidth",b.getDouble("nearSpanX")),v.optDouble("normalDepth",b.getDouble("nearSpanZ")),v.optBoolean("previewMode",false)),p.getDouble("centerX"),p.getDouble("centerZ"),p.getDouble("baseY"))}
    private fun hash(source:NativePacketSource):String {
        val hash=MessageDigest.getInstance("SHA-256");val row=ByteBuffer.allocate(80).order(ByteOrder.LITTLE_ENDIAN)
        for(packet in source.world!!.packets){val rows=source.world.instanceRows(packet)
            repeat(packet.count){i->row.clear();repeat(16){row.putFloat(rows.getFloat(i*96+it*4))};repeat(4){row.putFloat(rows.getFloat(i*96+80+it*4))};hash.update(row.array())}}
        return hash.digest().joinToString(""){"%02x".format(it.toInt() and 255)}
    }
    @Test fun actualFloat32InstanceRowsMatchTheUnmodifiedFormalPlacementClosureAtAllThreeQualities(){
        val cases=oracle.getJSONArray("placements");assertEquals(18,cases.length())
        for(i in 0 until cases.length()){val c=cases.getJSONObject(i);val compiler=NativeCloudCompiler();val w=weather(c);val context=context(c);val prefixes=c.getJSONArray("prefixes")
            repeat(prefixes.length()){j->val expected=prefixes.getJSONObject(j);val actual=compiler.prepare(context,w,expected.getDouble("density"))
                assertEquals(c.getInt("total"),actual.instances);assertEquals(expected.getInt("visible"),actual.visibleInstances)
                assertEquals(c.getLong("randomTail"),actual.randomTail)
                assertEquals("case $i quality $j",expected.getString("sha256"),hash(actual.source))
                assertEquals((0 until c.getJSONArray("groupEnds").length()).map{c.getJSONArray("groupEnds").getInt(it)},actual.groupEnds)
                assertTrue(actual.visibleInstances in actual.groupEnds);assertEquals(PacketOwners.CLOUDS,actual.source.owner)
                assertTrue(actual.source.world!!.packets.all{it.layer=="clouds"&&it.auxChannels==listOf("cloudCenter","cloudVelocity")&&!it.castShadow&&!it.receiveShadow})
            };compiler.clear()
        }
    }
    @Test fun cloudColorMatchesTheFormalDayNightAndWeatherBlend(){
        val cases=oracle.getJSONArray("placements")
        repeat(cases.length()){i->val c=cases.getJSONObject(i);val w=weather(c);val tints=c.getJSONArray("tints")
            repeat(tints.length()){j->val t=tints.getJSONObject(j);val expected=t.getJSONArray("rgb")
                val actual=NativeEnvironmentContext("UTC",NativeLightingQuality.HIGH,24.0,110.0,45.0,weather=NativeWeatherOverride(w.kind,w.thunderstorm,w.cloudIntensity)).sample(t.getLong("time")).cloudColor
                repeat(3){assertEquals(expected.getDouble(it),actual[it].toDouble(),2e-7)}
            }
        }
    }
    @Test fun separateWorkersShareAStableCloudIdentityAndCancellationPreservesTheLastPreparedInput(){
        val c=oracle.getJSONArray("placements").getJSONObject(6);val context=context(c);val weather=weather(c);val compiler=NativeCloudCompiler()
        val before=compiler.prepare(context,weather);val other=NativeCloudCompiler().prepare(context,weather)
        assertNotSame(before.source,other.source);assertNotEquals(before.source.uploadIdentity,other.source.uploadIdentity);assertEquals(before.source.ownerIdentity,other.source.ownerIdentity)
        var checks=0
        assertThrows(CancellationException::class.java){compiler.prepare(context,weather.copy(seed=weather.seed+1),cancelled={++checks>8})}
        assertSame(before,compiler.prepare(context,weather))
        val empty=compiler.prepare(context,weather.copy(cloudCount=0));assertNull(empty.source.world);assertEquals(0,empty.visibleInstances)
        assertThrows(IllegalArgumentException::class.java){NativePacketBuilder("atmosphere:unknown")}
        assertThrows(IllegalArgumentException::class.java){NativePacketBuilder(PacketOwners.CLOUDS)}
        compiler.clear()
    }
    @Test fun cloudRuntimeIsExplicitAndFreezesTheProducerSpanInsteadOfAdmittingOtherOptics(){
        val span=mutableListOf(300f,400f)
        val material=NativeRenderMaterial(unlit=true,environment=NativeMaterialBinding(cloud=true),fog=false,
            surface=SurfaceCoverage(SurfaceEffects.NONE,emptyList(),emptyList(),SurfaceOptics(cloud=SourceCloud(0f,span))))
        fun source(value:NativeRenderMaterial):NativePacketSource {
            val builder=NativePacketBuilder(PacketOwners.CLOUDS,NativePacketLayer.CLOUDS,NativeCloudKey("f".repeat(64)))
            builder.add(CuboidGeometry.create(),value,FloatBuffer.wrap(FloatArray(16){if(it in listOf(0,5,10,15))1f else 0f}),
                aux=FloatBuffer.wrap(floatArrayOf(0f,0f,.1f,.2f)),castShadow=false,receiveShadow=false)
            return builder.build()
        }
        val sample=NativeEnvironmentContext("UTC",NativeLightingQuality.HIGH,24.0,110.0,45.0).sample(1_792_886_400_000L)
        val prepared=source(material);span[0]=Float.NaN
        assertEquals(listOf(300f,400f),prepared.surfaces.single().optics.cloud!!.span)
        assertThrows(UnsupportedOperationException::class.java){(prepared.surfaces.single().optics.cloud!!.span as MutableList).clear()}
        prepared.validateRuntime(sample.uniforms())
        assertThrows(IllegalArgumentException::class.java){prepared.validateRuntime(NativeSceneEnvironment(sample.lighting,sample.surface))}
        val frozenMaterial=material.copy(surface=prepared.surfaces.single())
        assertThrows(IllegalArgumentException::class.java){source(frozenMaterial.copy(depthWrite=false)).validateRuntime(sample.uniforms())}
        assertThrows(IllegalArgumentException::class.java){source(frozenMaterial.copy(surface=frozenMaterial.surface.copy(optics=frozenMaterial.surface.optics.copy(fluidSurface=true)))).validateRuntime(sample.uniforms())}
    }
}
