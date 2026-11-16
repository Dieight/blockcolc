package com.blockcolc.presentation

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PanelWeatherPhysicsTest {
    private fun oracle()=JSONObject(javaClass.getResource("/presentation-oracle.json")!!.readText()).getJSONObject("panelWeather")
    private fun drops(rows:JSONArray)=List(rows.length()){i->val d=rows.getJSONObject(i)
        GlassRaindrop(d.getDouble("x"),d.getDouble("y"),d.getDouble("vx"),d.getDouble("vy"),d.getDouble("radius"),d.getDouble("age"),if(d.has("holdSeconds"))d.getDouble("holdSeconds")else null)
    }
    private fun assertDrops(expected:JSONArray,actual:List<GlassRaindrop>){
        val source=drops(expected);assertEquals(source.size,actual.size)
        source.zip(actual).forEach{(e,a)->
            listOf(e.x to a.x,e.y to a.y,e.vx to a.vx,e.vy to a.vy,e.radius to a.radius,e.age to a.age).forEach{(x,y)->assertEquals(x,y,1e-10)}
            assertEquals(e.holdSeconds,a.holdSeconds)
        }
    }
    @Test fun perceptualProfilesAndRawSnowThresholdsMatchFormalPanel(){
        val cases=oracle().getJSONArray("profiles")
        for(i in 0 until cases.length()){
            val c=cases.getJSONObject(i);val value=c.getDouble("value");val e=c.getJSONObject("rain");val a=PanelWeatherPhysics.rainProfile(value)
            assertEquals(e.getInt("maxDrops"),a.maxDrops);assertEquals(e.getInt("staticDrops"),a.staticDrops);assertEquals(e.getInt("spawnIntervalMs"),a.spawnIntervalMs)
            mapOf("opacity" to a.opacity,"radiusMin" to a.radiusMin,"radiusMax" to a.radiusMax,"holdSecondsMin" to a.holdSecondsMin,
                "holdSecondsMax" to a.holdSecondsMax,"terminalSpeed" to a.terminalSpeed,"trailScale" to a.trailScale).forEach{(key,v)->assertEquals(e.getDouble(key),v,1e-12)}
            val snow=PanelWeatherPhysics.snowProfile(value);assertEquals(c.getJSONObject("snow").getString("tier"),snow.tier)
            assertEquals(c.getJSONObject("snow").getDouble("depthCssPx"),snow.depth,0.0)
        }
    }
    @Test fun heldDampedSlidingCoalescenceAndLightningAfterimageMatchFormalSource(){
        val data=oracle();val steps=data.getJSONArray("steps")
        for(i in 0 until steps.length()){val c=steps.getJSONObject(i)
            assertDrops(c.getJSONArray("expected"),PanelWeatherPhysics.advance(drops(c.getJSONArray("drops")),c.getDouble("delta"),c.getDouble("height"),c.getDouble("terminal")))
        }
        val merges=data.getJSONArray("merges")
        for(i in 0 until merges.length()){val c=merges.getJSONObject(i);assertDrops(c.getJSONArray("expected"),PanelWeatherPhysics.merge(drops(c.getJSONArray("drops"))))}
        val strikes=data.getJSONArray("lightning")
        for(i in 0 until strikes.length()){val c=strikes.getJSONObject(i);assertEquals(c.getDouble("expected"),PanelWeatherPhysics.lightningOpacity(c.getDouble("age")),1e-12)}
    }
    @Test fun pausedAndReducedMotionFramesDoNotAdvanceAndLongUseRemainsBounded(){
        val sim=PanelWeatherSimulation(false,1.0,1234,true)
        var image=sim.frame(340.0,300.0);var sawStrike=false;val targets=mutableSetOf<Double>()
        repeat(20000){
            image=sim.frame(340.0,300.0,.032);assertTrue(image.drops.size<=24)
            assertTrue(image.drops.all{it.x.isFinite()&&it.y.isFinite()&&it.radius<=4.8})
            image.lightning?.let{sawStrike=true;targets+=it.x;assertEquals(9,it.offsets.size);assertTrue(image.lightningAgeMs<=1650)}
        }
        assertTrue(sawStrike);assertTrue(targets.size>3)
        val static=sim.frame(340.0,300.0,still=true)
        repeat(10){assertEquals(static,sim.frame(340.0,300.0,still=true))}
        assertNull(static.lightning)
        val control=PanelWeatherSimulation(false,1.0,1234,true);control.frame(340.0,300.0)
        repeat(20000){control.frame(340.0,300.0,.032)}
        assertEquals(control.frame(340.0,300.0,.032),sim.frame(340.0,300.0,.032))
        val snowfall=PanelWeatherSimulation(true,1.0,5,false)
        repeat(20000){val frame=snowfall.frame(340.0,300.0,.032);assertTrue(frame.flakes.size<=48);assertTrue(frame.drops.isEmpty())}
        assertEquals(9,snowfall.frame(340.0,300.0,still=true).flakes.size)
    }
    @Test fun invalidInputCannotCreateAnUnboundedOrNonFiniteFrame(){
        val invalid=GlassRaindrop(Double.NaN,0.0,0.0,0.0,1.0,0.0)
        assertTrue(PanelWeatherPhysics.advance(listOf(invalid),Double.POSITIVE_INFINITY,Double.NaN).isEmpty())
        assertEquals(0.0,PanelWeatherPhysics.lightningOpacity(Double.NaN),0.0)
        assertEquals(PanelWeatherFrame(),PanelWeatherSimulation(false,Double.NaN,0,true).frame(300.0,300.0,100.0))
    }
}
