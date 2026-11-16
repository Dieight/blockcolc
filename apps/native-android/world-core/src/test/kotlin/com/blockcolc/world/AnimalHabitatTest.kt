package com.blockcolc.world

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AnimalHabitatTest {
    private fun fixture()=JSONObject(javaClass.getResource("/animal-habitat-oracle.json")!!.readText())
    private fun payload()=javaClass.getResource("/animal-habitat.bin")!!.readBytes()
    private fun owners()=fixture().getJSONArray("owners").let{a->List(a.length()){a.getString(it)}}
    private fun read(data:ByteArray=payload())=AnimalHabitatInput.read(ByteBuffer.wrap(data),owners())
    private fun point(p:JSONObject)=AnimalPoint(p.getDouble("x"),p.getDouble("y"),p.getDouble("z"))
    private fun habitat():NativeAnimalHabitat {
        val f=fixture();val b=f.getJSONObject("bounds");val seeds=f.getJSONArray("landSeeds")
        return NativeAnimalHabitat(read(),AnimalBounds(b.getDouble("minX"),b.getDouble("maxX"),b.getDouble("minZ"),b.getDouble("maxZ")),point(f.getJSONObject("center")),List(seeds.length()){point(seeds.getJSONObject(it))})
    }
    @Test fun currentSourceWaterFlightAndClearanceQueriesMatchWithRealOriginalShapes() {
        val h=habitat();val rows=fixture().getJSONArray("queries");assertEquals(160,rows.length())
        for(i in 0 until rows.length()){
            val row=rows.getJSONObject(i);val p=point(row.getJSONObject("p"));val water=h.waterAt(p.x,p.z)
            if(row.isNull("water"))assertNull("case $i",water)else assertEquals(row.getDouble("water"),water!!,1e-6)
            assertEquals("case $i",row.getDouble("flightFloor"),h.flightFloor(p.x,p.z),1e-6)
            assertEquals("case $i",row.getBoolean("swimClear"),h.swimClear(p));assertEquals("case $i",row.getBoolean("obstacleClear"),h.obstacleClear(p))
        }
    }
    @Test fun collisionCodecRejectsCorruptionAndUnknownOwnersBeforeAWorldExists() {
        assertEquals(4,read().surfaces.size);assertTrue(read().solids.size>=4)
        assertThrows(IllegalArgumentException::class.java){read(payload().copyOf(payload().size-4))}
        for((at,value)in listOf(0 to 0,4 to 2,12 to Int.MAX_VALUE,24 to 1,52 to 4)){
            val data=payload();ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).putInt(at,value)
            assertThrows("offset $at",IllegalArgumentException::class.java){read(data)}
        }
        val owner=32+4*24+24;val data=payload();ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).putInt(owner,999)
        assertThrows(IllegalArgumentException::class.java){read(data)}
        val nonFinite=payload();ByteBuffer.wrap(nonFinite).order(ByteOrder.LITTLE_ENDIAN).putFloat(32,Float.NaN)
        assertThrows(IllegalArgumentException::class.java){read(nonFinite)}
    }
    @Test fun overlapAndWetDryRulesRemainStableWithoutContinuousCoordinateMemoization() {
        val h=habitat();assertEquals(.5,h.waterAt(2.0,3.0)!!,0.0);assertNull(h.waterAt(4.0,3.0))
        val bytes=h.groundIndexBytes();repeat(1000){i->h.waterAt(-7.0+i*.013,1.25)};assertEquals(bytes,h.groundIndexBytes())
        val before=h.world.stamp(AnimalBounds(5.0,6.0,5.0,6.0))
        h.world.replaceOwner("building:a",emptyList());assertEquals(before,h.world.stamp(AnimalBounds(5.0,6.0,5.0,6.0)))
        assertTrue(h.obstacleClear(AnimalPoint(-2.0,.5,0.0)))
    }
    @Test fun reusedGroundKeepsCallerChangesAndEachRuntimesCollisionEditsIsolated() {
        val source=read();val surfaces=source.surfaces.toMutableList();val solids=source.solids.toMutableList()
        val frozen=AnimalHabitatInput(surfaces,solids)
        val bounds=AnimalBounds(-20.0,20.0,-20.0,20.0);val center=AnimalPoint(0.0,0.0,0.0)
        val first=NativeAnimalHabitat(frozen,bounds,center,emptyList())
        val shared=frozen.surfaceIndex
        surfaces.clear();solids.clear()
        val second=NativeAnimalHabitat(frozen,bounds,center,emptyList())
        assertSame(shared,frozen.surfaceIndex)
        assertEquals(source.surfaces,frozen.surfaces);assertEquals(source.solids,frozen.solids)
        assertEquals(first.waterAt(2.0,3.0),second.waterAt(2.0,3.0))
        val region=AnimalBounds(-10.0,10.0,-10.0,10.0)
        val before=second.world.query(region)
        for(owner in frozen.solids.map{it.owner}.distinct())first.world.replaceOwner(owner,emptyList())
        assertEquals(before,second.world.query(region))
        assertThrows(UnsupportedOperationException::class.java){(frozen.surfaces as MutableList).clear()}
    }
}
