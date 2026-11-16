package com.blockcolc.world

import com.blockcolc.world.generation.BlueprintSnapshot
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BlueprintWireSerializationTest {
    @Test fun serializedBlueprintsAndGeometryDigestsMatchIndependentJsonWire(){
        val source=JSONObject(javaClass.getResource("/blueprint-wire-golden.json")!!.readText()).getJSONArray("cases")
        for(i in 0 until source.length()){
            val row=source.getJSONObject(i);val snapshot=BlueprintSnapshot.read(row.getJSONObject("input"))
            assertEquals("canonical case $i",row.getString("canonical"),snapshot.canonical)
            assertEquals("geometry case $i",row.getString("geometrySha"),snapshot.geometrySha)
        }
    }
}
