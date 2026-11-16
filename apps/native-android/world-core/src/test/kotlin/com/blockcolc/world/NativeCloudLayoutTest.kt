package com.blockcolc.world

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeCloudLayoutTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-cloud-oracle.json")!!.readText())}
    @Test fun budgetDistributionAndRandomConsumptionMatchTheFormalSourceForAllWeatherAndExtents(){
        val cases=oracle.getJSONArray("cases");assertEquals(216,cases.length())
        repeat(cases.length()){i->val c=cases.getJSONObject(i);val input=c.getJSONObject("input");val w=c.getJSONObject("weather")
            val kind=NativeWeatherKind.entries.single{it.wire==w.getString("kind")}
            val weather=NativeEnvironment.externalWeather("2026-10-26",NativeWeatherOverride(kind,w.getBoolean("thunderstorm"),w.getDouble("cloudIntensity"))).copy(cloudCount=input.getInt("weatherCloudCount"))
            val view=NativeCloudView(input.optDouble("contentWidth",Double.NaN),input.optDouble("contentDepth",Double.NaN),input.optDouble("visibleWidth",Double.NaN),input.optDouble("visibleDepth",Double.NaN),
                input.optDouble("normalWidth",Double.NaN),input.optDouble("normalDepth",Double.NaN),input.optBoolean("previewMode",false))
            val actual=NativeCloudLayout.budget(view,weather,input.getDouble("weatherDensity"));val b=c.getJSONObject("budget")
            for((name,value)in mapOf("cloudCount" to actual.cloudCount,"maxInstances" to actual.maxInstances,"nearCloudCount" to actual.nearCloudCount,"farCloudCount" to actual.farCloudCount))assertEquals("$i $name",b.getInt(name),value)
            for((name,value)in mapOf("blockScale" to actual.blockScale,"spanX" to actual.spanX,"spanZ" to actual.spanZ,"nearSpanX" to actual.nearSpanX,"nearSpanZ" to actual.nearSpanZ,"farBlockScale" to actual.farBlockScale))assertEquals("$i $name",b.getDouble(name),value,1e-10)
            assertEquals(b.getBoolean("previewMode"),actual.previewMode)
            val random=NativeCloudLayout.random(c.getLong("seed"));val groups=NativeCloudLayout.groups(actual,weather,random);val expected=c.getJSONArray("groups")
            assertEquals("case $i",expected.length(),groups.size)
            for((index,group)in groups.withIndex()){val row=expected.getJSONObject(index)
                assertEquals(row.getString("region"),group.region.wire);assertEquals(row.getString("kind"),group.kind.wire);assertEquals(row.getInt("blocks"),group.blocks)
                assertEquals(row.getDouble("x"),group.x,1e-10);assertEquals(row.getDouble("z"),group.z,1e-10);assertEquals(row.getDouble("horizontalScale"),group.horizontalScale,1e-10)
            }
            assertEquals(c.getDouble("nextRandom"),random(),0.0);assertEquals(c.getDouble("speed"),NativeCloudLayout.speed(weather),1e-12)
            var count=0;val ends=groups.map{count+=it.blocks;count};val cuts=c.getJSONArray("cuts")
            repeat(cuts.length()){j->val cut=cuts.getJSONObject(j);assertEquals(cut.getInt("count"),NativeCloudLayout.drawCount(ends,cut.getDouble("density")))}
        }
    }
    @Test fun allSixVolumetricShapesMatchEveryFormalVoxelIncludingUndersidesAndSignedSeeds(){
        val shapes=oracle.getJSONArray("shapes");assertEquals(36,shapes.length())
        repeat(shapes.length()){i->val c=shapes.getJSONObject(i);val kind=NativeCloudKind.entries.single{it.wire==c.getString("kind")};val cells=c.getJSONArray("voxels")
            val expected=(0 until cells.length()).map{j->val v=cells.getJSONObject(j);NativeCloudVoxel(v.getInt("x"),v.getInt("y"),v.getInt("z"))}
            val actual=NativeCloudLayout.voxels(kind,c.getInt("variant"));assertEquals("${kind.wire} ${c.getInt("variant")}",expected,actual)
            assertTrue(actual.isNotEmpty());assertTrue(actual.any{it.y<=0});assertTrue(actual.any{it.y>1})
        }
    }
    @Test fun clearSkiesDoNotGainLargeBanksAndFarTerrainKeepsARealCloudShare(){
        val view=NativeCloudView(100.0,80.0,1000.0,800.0,260.0,240.0)
        for(kind in NativeWeatherKind.entries){val weather=NativeEnvironment.externalWeather("2026-10-26",NativeWeatherOverride(kind)).copy(cloudCount=12)
            val budget=NativeCloudLayout.budget(view,weather);val groups=NativeCloudLayout.groups(budget,weather,NativeCloudLayout.random(1234))
            assertTrue(groups.any{it.region==NativeCloudRegion.FAR});assertTrue(budget.farCloudCount>=budget.nearCloudCount)
            if(kind==NativeWeatherKind.CLEAR)assertTrue(groups.all{it.horizontalScale==1.0&&it.kind!=NativeCloudKind.BANK})
            if(kind!=NativeWeatherKind.CLOUDY)assertTrue(groups.filter{it.region==NativeCloudRegion.NEAR}.all{it.kind !in setOf(NativeCloudKind.BANK,NativeCloudKind.STRATUS)})
        }
        assertEquals(0,NativeCloudLayout.drawCount(listOf(10,20),Double.NaN))
        assertThrows(IllegalArgumentException::class.java){NativeCloudLayout.drawCount(listOf(20,10),.5)}
    }
}
