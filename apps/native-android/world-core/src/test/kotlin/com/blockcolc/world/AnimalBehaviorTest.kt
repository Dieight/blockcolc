package com.blockcolc.world

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class AnimalBehaviorTest {
    private fun point(p:JSONObject)=AnimalPoint(p.getDouble("x"),p.getDouble("y"),p.getDouble("z"))
    private fun same(e:JSONObject,p:AnimalPoint){assertEquals(e.getDouble("x"),p.x,1e-8);assertEquals(e.getDouble("y"),p.y,1e-8);assertEquals(e.getDouble("z"),p.z,1e-8)}
    @Test fun seededRandomKeepsJavaScriptSignedAndUnsignedIntegerSemantics() {
        val rows=JSONObject(javaClass.getResource("/animal-habitat-oracle.json")!!.readText()).getJSONArray("random")
        for(i in 0 until rows.length()){val r=rows.getJSONObject(i);assertEquals(r.getDouble("value"),animalRandomUnit(r.getLong("seed")),0.0)}
    }
    @Test fun nativeFishSchoolsJumpsAndBirdFlightsMatchEveryCurrentSourceStep() {
        val data=JSONObject(javaClass.getResource("/animal-behavior-oracle.json")!!.readText());val b=data.getJSONObject("bounds")
        val surfaces=data.getJSONArray("surfaces");val seeds=data.getJSONArray("landSeeds")
        val habitat=NativeAnimalHabitat(AnimalHabitatInput(List(surfaces.length()){i->val s=surfaces.getJSONObject(i)
            AnimalSurface(s.getDouble("minX"),s.getDouble("maxX"),s.getDouble("minZ"),s.getDouble("maxZ"),s.getDouble("top"),s.getBoolean("water"),s.getBoolean("grass"))},emptyList()),
            AnimalBounds(b.getDouble("minX"),b.getDouble("maxX"),b.getDouble("minZ"),b.getDouble("maxZ")),point(data.getJSONObject("center")),List(seeds.length()){point(seeds.getJSONObject(it))})
        val initial=data.getJSONObject("initial");val raw=initial.getJSONArray("agents")
        val agents=List(raw.length()){i->val a=raw.getJSONObject(i);NativeAnimalAgent(a.getInt("id"),a.getString("species"),a.getString("kind"),point(a.getJSONObject("position")),a.getDouble("heading"),
            a.getString("activity"),a.getDouble("remaining"),a.getDouble("phase"),jumpCooldown=a.getDouble("jumpCooldown"),school=a.getInt("school"),waterY=if(a.has("waterY"))a.getDouble("waterY")else null)}
        val community=NativeAnimalCommunity(habitat,initial.getLong("seed"),agents,initial.getLong("sequence"),initial.getDouble("time"))
        val frames=data.getJSONArray("frames");assertEquals(600,frames.length())
        for(i in 0 until frames.length()){
            val f=frames.getJSONObject(i);if(i==30)community.tap(1);if(i==90)community.tap(4);if(i==200)community.tap(2)
            if(i==150){val a=agents[1];val to=AnimalPoint(a.position.x+sin(a.heading)*1.4,a.position.y,a.position.z+cos(a.heading)*1.4)
                a.route=AnimalFlightRoute(a.position,to,to,1.0,0.0,1.1);a.activity="jump";a.ripple=1.0}
            val visible=f.getJSONArray("visible").let{v->(0 until v.length()).map{v.getInt(it)}.toSet()}
            community.update(f.getDouble("dt"),f.getBoolean("motion"),visible,f.getDouble("activityScale"))
            assertEquals("frame $i time",f.getDouble("time"),community.time,1e-10);assertEquals("frame $i random",f.getLong("sequence"),community.sequence)
            val expected=f.getJSONArray("agents")
            for(j in agents.indices){val e=expected.getJSONObject(j);val a=agents[j];same(e.getJSONObject("position"),a.position)
                assertEquals("frame $i actor $j",e.getString("activity"),a.activity)
                for((key,v)in listOf("heading" to a.heading,"remaining" to a.remaining,"speed" to a.speed,"traveled" to a.traveled,"response" to a.response,
                    "ripple" to a.ripple,"jumpCooldown" to a.jumpCooldown))assertEquals("frame $i actor $j $key",e.getDouble(key),v,1e-8)
                assertEquals(e.getInt("reactions"),a.reactions)
                if(e.has("route")){val r=e.getJSONObject("route");val actual=a.route!!;assertEquals(r.getDouble("t"),actual.t,1e-8);same(r.getJSONObject("to"),actual.to)}else assertNull(a.route)
            }
        }
    }
    @Test fun landPlanningCanYieldAndCancelWithoutRetainingAStaleSearch() {
        val input=AnimalHabitatInput(listOf(AnimalSurface(-80.0,80.0,-80.0,80.0,0.0,false,true)),emptyList())
        val habitat=NativeAnimalHabitat(input,AnimalBounds(-80.0,80.0,-80.0,80.0),AnimalPoint(0.0,0.0,0.0),emptyList())
        val a=NativeAnimalAgent(1,"sheep","land",AnimalPoint(0.0,0.0,0.0),0.0,"graze",0.0,0.0)
        val community=NativeAnimalCommunity(habitat,12345,listOf(a));community.update(.033,true)
        habitat.world.replaceOwner("later",emptyList());community.pumpPlanning(1_000_000_000)
        assertEquals(1,community.cancelled);assertEquals("graze",a.activity);assertNull(a.walker!!.route)
        a.remaining=0.0;community.update(.033,true);repeat(20){community.pumpPlanning(1_000_000_000)}
        assertEquals("walk",a.activity);assertTrue(community.plans>0);assertNotNull(a.walker!!.route)
        community.close()
    }
}
