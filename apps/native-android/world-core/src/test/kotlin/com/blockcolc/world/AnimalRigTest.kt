package com.blockcolc.world

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AnimalRigTest {
    private fun point(p:JSONObject)=AnimalPoint(p.getDouble("x"),p.getDouble("y"),p.getDouble("z"))
    @Test fun everySourceSpeciesPoseAndColorMatchesActualThreeModelMatrices() {
        val rows=JSONArray(javaClass.getResource("/animal-rig-oracle.json")!!.readText());assertEquals(198,rows.length())
        val rig=AnimalRig()
        val world=AnimalCollisionWorld(AnimalBounds(-8.0,8.0,-8.0,8.0),listOf(AnimalSolid("floor","ground",-8.0,8.0,-2.0,0.0,-8.0,8.0)))
        for(i in 0 until rows.length()){
            val row=rows.getJSONObject(i);val a=row.getJSONObject("agent")
            val agent=NativeAnimalAgent(a.getInt("id"),a.getString("species"),a.getString("kind"),point(a.getJSONObject("position")),a.getDouble("heading"),a.getString("activity"),
                a.getDouble("remaining"),a.getDouble("phase"),speed=a.getDouble("speed"),traveled=a.getDouble("traveled"),response=a.getDouble("response"),ripple=a.getDouble("ripple"),waterY=a.getDouble("waterY"))
            if(agent.kind=="land")agent.walker=AnimalWalker(AnimalNavigator(world,AnimalBodies.all.single{it.id==agent.species}),agent.position)
            if(a.has("route")){val r=a.getJSONObject("route");agent.route=AnimalFlightRoute(point(r.getJSONObject("from")),point(r.getJSONObject("to")),point(r.getJSONObject("control")),r.getDouble("height"),r.getDouble("t"),r.getDouble("duration"))}
            rig.update(listOf(agent),row.getDouble("time"));val meshes=row.getJSONArray("meshes")
            for(k in 0..3){val m=meshes.getJSONObject(k);assertEquals("case $i kind $k count",m.getInt("count"),rig.counts[k]);val matrices=m.getJSONArray("matrices");val colors=m.getJSONArray("colors")
                for(slot in 0 until rig.counts[k]){
                    for(c in 0..15)assertEquals("case $i kind $k slot $slot matrix $c",matrices.getDouble(slot*16+c).toFloat(),rig.value(k,slot,c),1e-6f)
                    for(c in 0..2)assertEquals("case $i color",colors.getDouble(slot*3+c).toFloat(),rig.value(k,slot,16+c),1e-7f)
                    assertEquals(1,rig.actorId(k,slot));assertEquals(k.toFloat(),rig.value(k,slot,21),0f);assertEquals(1f,rig.value(k,slot,22),0f)
                }
            }
        }
    }
    @Test fun inactiveSlotsCollapseWithoutReallocatingOrRetainingAFormerActorHit() {
        val rig=AnimalRig();val a=NativeAnimalAgent(1,"gull","bird",AnimalPoint(0.0,0.0,0.0),0.0,"perch",1.0,0.0)
        rig.update(listOf(a),0.0);val count=rig.counts[0];assertTrue(count>0)
        rig.update(emptyList(),1.0)
        for(slot in 0 until count){assertEquals(0f,rig.value(0,slot,22),0f);assertEquals(0,rig.actorId(0,slot))}
        val buffer=ByteBuffer.allocateDirect(48*4).order(ByteOrder.LITTLE_ENDIAN);rig.copySlots(0,intArrayOf(0,1),buffer)
        assertEquals(192,buffer.position());assertEquals(0f,buffer.getFloat(88),0f)
        rig.update(listOf(a),2.0);assertEquals(count,rig.counts[0]);assertEquals(1f,rig.value(0,0,22),0f)
    }
}
