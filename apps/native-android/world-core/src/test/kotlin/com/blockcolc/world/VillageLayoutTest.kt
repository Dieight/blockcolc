package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class VillageLayoutTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/generation-oracle.json")!!.readText())}
    private fun rows(a:JSONArray)=List(a.length()){a.getJSONObject(it)}
    private fun bounds(x:JSONObject)=FootprintBounds(x.getLong("minX"),x.getLong("maxX"),x.getLong("minZ"),x.getLong("maxZ"))
    private fun point(x:JSONObject)=Position2(x.getDouble("x"),x.getDouble("z"))
    private fun road(x:JSONObject)=RoadCell(x.getInt("x"),x.getInt("z"))
    private fun position(label:String,expected:JSONObject,actual:Position3){
        assertEquals("$label x",expected.getDouble("x"),actual.x,1e-9);assertEquals("$label y",expected.getDouble("y"),actual.y,1e-9);assertEquals("$label z",expected.getDouble("z"),actual.z,1e-9)
    }
    private fun spatial(label:String,expected:JSONObject,actualPosition:Position3,rotation:Double,footprint:Footprint,offset:Position2){
        position(label,expected.getJSONObject("worldPosition"),actualPosition)
        assertEquals("$label rotation",expected.getDouble("rotationY"),rotation,1e-12)
        val footprintExpected=expected.getJSONObject("footprint")
        assertEquals("$label width",footprintExpected.getDouble("width"),footprint.width,0.0);assertEquals("$label depth",footprintExpected.getDouble("depth"),footprint.depth,0.0)
        val offsetExpected=expected.getJSONObject("blueprintOffset")
        assertEquals("$label offset x",offsetExpected.getDouble("x"),offset.x,1e-12);assertEquals("$label offset z",offsetExpected.getDouble("z"),offset.z,1e-12)
    }
    @Test fun actualFormalSourceIsBoundToTheLayoutOracle(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/village.ts").isFile}
        val hashes=oracle.getJSONObject("sourceHashes")
        hashes.keys().forEach{path->val actual=MessageDigest.getInstance("SHA-256").digest(File(root,path).readBytes()).joinToString(""){"%02x".format(it.toInt() and 255)};assertEquals("Stale generation oracle: $path",hashes.getString(path),actual)}
    }
    @Test fun arbitraryBlueprintBoundsCountsMissingPlotsAndRewardsMatchTheFormalGenerator(){
        val layouts=rows(oracle.getJSONArray("layouts"));assertTrue(layouts.size>20)
        for(case in layouts){
            val name=case.getString("name")
            val inputs=rows(case.getJSONArray("inputs")).map{VillageInput(it.getLong("settlementIndex"),bounds(it.getJSONObject("blueprint").getJSONObject("bounds")))}
            val placements=VillageLayout.generate(inputs);val truth=rows(case.getJSONArray("placements"))
            assertEquals(name,truth.size,placements.size)
            for((i,p)in placements.withIndex()){
                assertEquals("$name index $i",truth[i].getLong("settlementIndex"),p.settlementIndex)
                spatial("$name:$i",truth[i],p.worldPosition,p.rotationY,p.footprint,p.blueprintOffset)
                assertEquals("$name entrance $i",road(truth[i].getJSONObject("entrance")),p.entrance)
            }
            assertEquals("$name plaza",road(case.getJSONObject("plaza")),VillageLayout.plaza(placements))
            val roads=VillageLayout.roads(placements);val expectedRoads=rows(case.getJSONArray("roads")).map(::road)
            assertEquals("$name road count",expectedRoads.size,roads.size)
            for(i in roads.indices)assertEquals("$name road $i",expectedRoads[i],roads[i])
            val hosts=rows(case.getJSONArray("hosts")).map{host->DecorationHost(host.getString("projectId"),placements.first{it.settlementIndex==host.getLong("settlementIndex")})}
            val decorations=rows(case.getJSONArray("decorations")).map{d->DecorationInput(d.getString("rewardId"),d.getString("resourceId"),d.getString("date"),d.getString("projectId"),bounds(d.getJSONObject("blueprint").getJSONObject("bounds")),point(d.getJSONObject("localPosition")),d.getInt("rotationQuarterTurns"))}
            val placed=VillageLayout.decorations(decorations,hosts,roads);val expected=rows(case.getJSONArray("decorationPlacements"))
            assertEquals("$name reward count",expected.size,placed.size)
            for((i,p)in placed.withIndex()){
                val e=expected[i];assertEquals("$name reward identity $i",e.getString("rewardId"),p.input.rewardId)
                spatial("$name reward $i",e,p.worldPosition,p.rotationY,p.footprint,p.blueprintOffset)
            }
        }
    }
    @Test fun placementGroundSamplingIncludesNegativeRoundingAndFractionalCoordinates(){
        val samples=rows(oracle.getJSONArray("heights"));assertTrue(samples.size>2000)
        for(p in samples)assertEquals("height at $p",p.getDouble("height"),VillageLayout.terrainHeightAt(p.getDouble("x"),p.getDouble("z")),0.0)
    }
    @Test fun invalidOrCancelledGenerationCannotReturnAPartialLayout(){
        val shape=FootprintBounds(-2,10,-2,10)
        assertThrows(IllegalArgumentException::class.java){VillageLayout.generate(listOf(VillageInput(-1,shape)))}
        assertThrows(IllegalArgumentException::class.java){VillageLayout.generate(listOf(VillageInput(0,shape),VillageInput(0,shape)))}
        assertThrows(IllegalArgumentException::class.java){VillageLayout.generate(listOf(VillageInput(9_007_199_254_740_992L,shape)))}
        assertThrows(IllegalArgumentException::class.java){VillageLayout.terrainHeightAt(Double.NaN,0.0)}
        var checks=0
        assertThrows(CancellationException::class.java){VillageLayout.generate(List(100){VillageInput(it.toLong(),shape)}){++checks>=4}}
        assertTrue(checks>=4)
        val first=VillageLayout.generate(listOf(VillageInput(0,shape)))
        assertThrows(CancellationException::class.java){VillageLayout.roads(first){true}}
        assertEquals(first,VillageLayout.generate(listOf(VillageInput(0,shape))))
    }
}
