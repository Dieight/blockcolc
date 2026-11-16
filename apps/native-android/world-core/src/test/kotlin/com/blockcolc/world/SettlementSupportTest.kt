package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.ReadOnlyBufferException
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class SettlementSupportTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/generation-oracle.json")!!.readText())}
    private fun rows(a:JSONArray)=List(a.length()){a.getJSONObject(it)}
    private fun placement(value:JSONObject):VillagePlacement {
        val point=value.getJSONObject("worldPosition");val footprint=value.getJSONObject("footprint")
        val offset=value.getJSONObject("blueprintOffset");val entrance=value.getJSONObject("entrance")
        return VillagePlacement(value.getLong("settlementIndex"),Position3(point.getDouble("x"),point.getDouble("y"),point.getDouble("z")),value.getDouble("rotationY"),
            Footprint(footprint.getDouble("width"),footprint.getDouble("depth")),Position2(offset.getDouble("x"),offset.getDouble("z")),RoadCell(entrance.getInt("x"),entrance.getInt("z")))
    }
    private fun pad(value:JSONObject)=TerrainPad(value.getDouble("x"),value.getDouble("z"),value.getDouble("width"),value.getDouble("depth"),value.getDouble("groundLevel"))
    private fun hash(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}

    @Test fun everyEnvironmentUsesTheActualFormalBuildingAndRoadSupportDatum() {
        val layouts=rows(oracle.getJSONArray("layouts")).associateBy{it.getString("name")}
        val cases=rows(oracle.getJSONArray("supports"));assertEquals(layouts.size*4,cases.size)
        for(testCase in cases) {
            val name=testCase.getString("layout");val environment=WorldEnvironment.fromWire(testCase.getString("environment"))
            val initial=rows(layouts.getValue(name).getJSONArray("placements")).map(::placement)
            val actual=SettlementSupport.align(initial,environment)
            val expected=rows(testCase.getJSONArray("placements")).map(::placement)
            assertEquals("$name $environment buildings",expected,actual.placements)
            assertEquals("$name $environment pads",rows(testCase.getJSONArray("pads")).map(::pad),actual.pads)
            val extra=rows(testCase.getJSONArray("extraPads")).map(::pad)
            for(sample in rows(testCase.getJSONArray("samples")))assertEquals("$name $environment $sample",sample.getDouble("height"),
                SettlementSupport.groundHeightAt(sample.getDouble("x"),sample.getDouble("z"),environment,actual.placements,extra),0.0)
            val roads=VillageLayout.roads(actual.placements)
            assertEquals(rows(testCase.getJSONArray("roads")).map{RoadCell(it.getInt("x"),it.getInt("z"))},roads)
            val geometry=SettlementSupport.roads(roads,actual.placements,actual.pads,environment);val truth=testCase.getJSONObject("geometry")
            assertEquals(truth.getInt("cellCount"),geometry.cellCount);assertEquals(truth.getInt("triangleCount"),geometry.triangleCount);assertEquals(truth.getInt("vertexCount"),geometry.vertexCount)
            val coordinates=geometry.positions();val indices=geometry.indices()
            val positionBytes=ByteBuffer.allocate(coordinates.remaining()*4).order(ByteOrder.LITTLE_ENDIAN)
            while(coordinates.hasRemaining())positionBytes.putFloat(coordinates.get().toFloat())
            val indexBytes=ByteBuffer.allocate(indices.remaining()*4).order(ByteOrder.LITTLE_ENDIAN)
            while(indices.hasRemaining())indexBytes.putInt(indices.get())
            assertEquals("$name $environment position upload",truth.getString("positionsSha"),hash(positionBytes.array()))
            assertEquals("$name $environment triangles",truth.getString("indicesSha"),hash(indexBytes.array()))
            for(sample in rows(truth.getJSONArray("samples")))for(component in 0..2)
                assertEquals(sample.getJSONArray("values").getDouble(component),geometry.positions().get(sample.getInt("index")+component),1e-9)
        }
    }

    @Test fun onlyBuildingsCreatePadsAndPublishedGeometryCannotBeModified() {
        val input=VillageLayout.generate(listOf(VillageInput(0,FootprintBounds(-4,4,-3,3))))
        val aligned=SettlementSupport.align(input,WorldEnvironment.OCEAN)
        assertEquals(1,aligned.pads.size);assertEquals(4.0,aligned.placements.single().worldPosition.y,0.0)
        assertThrows(UnsupportedOperationException::class.java){(aligned.placements as MutableList).clear()}
        assertThrows(UnsupportedOperationException::class.java){(aligned.pads as MutableList).clear()}
        val road=SettlementSupport.roads(listOf(RoadCell(0,0)),aligned.placements,aligned.pads,WorldEnvironment.OCEAN)
        assertEquals(4,road.vertexCount);assertEquals(2,road.triangleCount)
        assertThrows(ReadOnlyBufferException::class.java){road.positions().put(0,99.0)}
        assertThrows(ReadOnlyBufferException::class.java){road.indices().put(0,99)}
        assertFalse(road.positions().hasArray());assertFalse(road.indices().hasArray())
        assertThrows(IllegalArgumentException::class.java){WorldEnvironment.fromWire("unknown")}
        assertThrows(IllegalArgumentException::class.java){TerrainPad(0.0,0.0,0.0,3.0,0.0)}
        assertThrows(CancellationException::class.java){SettlementSupport.align(input,WorldEnvironment.OCEAN){true}}
        assertThrows(CancellationException::class.java){SettlementSupport.roads(emptyList(),emptyList(),emptyList(),WorldEnvironment.OCEAN){true}}
        var checks=0
        assertThrows(CancellationException::class.java){SettlementSupport.placementHeight(input.single().copy(footprint=Footprint(96.0,96.0)),WorldEnvironment.VALLEY){++checks>4}}
    }
}
