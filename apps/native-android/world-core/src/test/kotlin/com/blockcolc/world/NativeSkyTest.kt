package com.blockcolc.world

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.FloatBuffer
import java.util.TimeZone
import java.util.concurrent.CancellationException

class NativeSkyTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-sky-oracle.json")!!.readText())}
    private fun coordinates(row:JSONObject)=if(row.isNull("coordinates"))null else row.getJSONObject("coordinates").let{NativeCoordinates(it.getDouble("latitude"),it.getDouble("longitude"))}
    private fun floats(a:JSONArray)=FloatArray(a.length()){a.getDouble(it).toFloat()}
    private fun floats(a:FloatBuffer)=FloatArray(a.remaining()).also{a.duplicate().get(it)}
    @Test fun redPinkAndBlueTwilightMatchTheCurrentFormalPaletteForLocalAndAstronomicalTime(){
        val rows=oracle.getJSONArray("twilight");assertEquals(116,rows.length());val variants=mutableSetOf<Boolean>()
        repeat(rows.length()){i->val row=rows.getJSONObject(i);val zone=TimeZone.getTimeZone(row.getString("zone"));val time=row.getLong("time");val c=coordinates(row)
            val raw=if(c==null)NativeEnvironment.localSun(time,zone)else NativeEnvironment.astronomySun(time,c)
            val state=NativeSky.twilight(raw,time,zone);val expected=row.getJSONObject("state");variants+=row.getDouble("variant")>.5
            for((name,value)in listOf("skyHorizonColor" to state.skyHorizonColor,"skyZenithColor" to state.skyZenithColor,"skyLowerColor" to state.skyLowerColor,
                "skyColor" to state.skyColor,"cloudColor" to state.cloudColor,"fogColor" to state.fogColor))assertEquals("case $i $name",expected.getInt(name),value)
            assertEquals(raw.sunPosition,state.sunPosition);assertEquals(raw.lunar,state.lunar);assertEquals(raw.exposure,state.exposure,0.0)
        };assertEquals(setOf(false,true),variants)
    }
    @Test fun currentDomeVertexColoursAndNightVisibilityAreSharedWithReflectionsAcrossAllWeatherAndQualities(){
        val rows=oracle.getJSONArray("cases");assertEquals(1296,rows.length());val weights=checkNotNull(NativeSkyGeometry.dome().colors())
        repeat(rows.length()){i->val row=rows.getJSONObject(i);val quality=when(row.getString("tier")){"low"->NativeLightingQuality.LOW;"balanced"->NativeLightingQuality.BALANCED;else->NativeLightingQuality.HIGH}
            val style=row.getString("style");val kind=row.getString("kind");val weather=NativeWeatherOverride(if(kind=="thunderstorm")NativeWeatherKind.RAIN else NativeWeatherKind.entries.single{it.wire==kind},kind=="thunderstorm",.72,.4)
            val sample=NativeEnvironment.sample(row.getLong("time"),TimeZone.getTimeZone(row.getString("zone")),quality,20.0,80.0,35.0,coordinates=coordinates(row),override=weather,skyOptions=NativeSkyOptions(style=="floating",style=="cold"))
            val sky=checkNotNull(sample.sky);val expected=row.getJSONObject("uniforms")
            for((key,value)in listOf("bcSkyStars" to sky.night.stars,"bcSkyGalaxy" to sky.night.galaxy,"bcSkyAurora" to sky.night.aurora,"bcSkyDensity" to sky.night.density))assertEquals("$i $key",expected.getDouble(key),value.toDouble(),2e-7)
            repeat(3){axis->assertEquals(row.getJSONArray("sun").getDouble(axis),sky.sunDirection[axis],2e-8);assertEquals(row.getJSONArray("moon").getDouble(axis),sky.moonDirection[axis],2e-8)
                assertEquals(row.getJSONArray("moonColour").getDouble(axis),sky.moonColor[axis].toDouble(),2e-7)
                assertEquals(expected.getJSONArray("bcSkyColdDirection").getDouble(axis),sky.night.coldDirection[axis].toDouble(),2e-8)
                assertEquals(expected.getJSONArray("bcSkyGalaxyNormal").getDouble(axis),sky.night.galaxyNormal[axis].toDouble(),3e-8)}
            assertEquals(row.getDouble("opacity"),sky.opacity.toDouble(),0.0);assertEquals(row.getBoolean("sunVisible"),sky.sunVisible);assertEquals(row.getBoolean("moonVisible"),sky.moonVisible)
            assertEquals(sky.night,sample.surface.night);assertEquals(sky.night,sample.uniforms().sky!!.night)
            val colors=row.getJSONArray("colours")
            repeat(13){band->repeat(3){axis->val at=band*25*3
                val actual=weights.get(at)*sky.gradient.horizon[axis]+weights.get(at+1)*sky.gradient.zenith[axis]+weights.get(at+2)*sky.gradient.lower[axis]
                assertEquals("$i band $band channel $axis",colors.getJSONArray(band).getDouble(axis),actual.toDouble(),3e-7)
            }}
        }
    }
    @Test fun sphereAndCelestialPlaneKeepThePinnedThreeVertexAttributesAndIndices(){
        val rows=oracle.getJSONArray("geometry");val actuals=listOf(NativeSkyGeometry.dome(),NativeSkyGeometry.celestial())
        for((i,geometry)in actuals.withIndex()){val expected=rows.getJSONObject(i)
            assertArrayEquals(floats(expected.getJSONArray("position")),floats(geometry.positions()),0f)
            assertArrayEquals(floats(expected.getJSONArray("normal")),floats(geometry.normals()),0f)
            assertArrayEquals(floats(expected.getJSONArray("uv")),floats(checkNotNull(geometry.textureCoordinates())),0f)
            val source=expected.getJSONArray("index");val index=checkNotNull(geometry.indices());val values=IntArray(index.remaining());index.get(values)
            assertArrayEquals(IntArray(source.length()){source.getInt(it)},values)
        }
    }
    @Test fun skyGeometryHasStableIdentityAndRequiresItsOwnValidatedRuntimeRatherThanStaticOwnerGuessing(){
        val compiler=NativeSkyCompiler();val source=compiler.prepare(false);assertSame(source,compiler.prepare(false))
        assertEquals(source.ownerIdentity,NativeSkyCompiler().prepare(false).ownerIdentity)
        assertNotEquals(source.ownerIdentity,NativeSkyCompiler().prepare(true).ownerIdentity)
        val sample=NativeEnvironmentContext("UTC",NativeLightingQuality.HIGH,20.0,80.0,35.0).sample(1_792_886_400_000L)
        source.validateRuntime(sample.uniforms());assertEquals(3,source.world!!.packets.size);assertEquals(2,source.world.geometries.size)
        assertThrows(IllegalArgumentException::class.java){source.validateRuntime(NativeSceneEnvironment(sample.lighting,sample.surface,sample.cloudColor))}
        assertThrows(IllegalArgumentException::class.java){NativeSkyCompiler().prepare(true).validateRuntime(sample.uniforms())}
        val empty=NativePacketBuilder(PacketOwners.SKY,NativePacketLayer.SKY,skyKey=checkNotNull(source.skyKey)).build()
        assertThrows(IllegalArgumentException::class.java){empty.validateRuntime(sample.uniforms())}
        var checks=0;assertThrows(CancellationException::class.java){compiler.prepare(true,cancelled={++checks>4})};assertSame(source,compiler.prepare(false))
        val mutable=mutableListOf(-1f,0f,0f);val sky=sample.sky!!.copy(night=sample.sky.night.copy(coldDirection=mutable))
        val frozen=NativeSceneEnvironment(sample.lighting,sample.surface,sample.cloudColor,sky);mutable[0]=Float.NaN
        assertEquals(listOf(-1f,0f,0f),frozen.sky!!.night.coldDirection)
        assertThrows(UnsupportedOperationException::class.java){(frozen.sky.night.coldDirection as MutableList).clear()}
        assertThrows(IllegalArgumentException::class.java){NativeMaterialBinding(surface=NativeSurfaceBinding(0f),sky=NativeSkyRole.SUN)}
        compiler.clear()
    }
}
