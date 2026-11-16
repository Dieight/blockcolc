package com.blockcolc.world

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AnimalRuntimeTest {
    private fun state():JSONObject=JSONObject("""{"schema":1,"scope":"full","rootRotationY":0,"bounds":{"minX":-50,"maxX":50,"minZ":-50,"maxZ":50},"center":{"x":0,"y":0,"z":0},"landSeeds":[{"x":-10,"y":0,"z":0}],"community":{"seed":12345,"sequence":0,"time":0,"agents":[{"id":1,"kind":"land","species":"sheep","position":{"x":-10,"y":0,"z":0},"heading":0,"activity":"graze","remaining":0,"phase":0,"speed":0,"traveled":0,"response":0,"reactions":0,"ripple":0,"jumpCooldown":30,"school":0},{"id":2,"kind":"fish","species":"salmon","position":{"x":10,"y":-0.6,"z":0},"heading":0,"activity":"swim","remaining":2,"phase":1,"speed":0,"traveled":0,"response":0,"reactions":0,"ripple":0,"jumpCooldown":30,"school":1,"waterY":0},{"id":3,"kind":"bird","species":"gull","position":{"x":-6,"y":0.08,"z":0},"heading":0,"activity":"perch","remaining":1,"phase":2,"speed":0,"traveled":0,"response":0,"reactions":0,"ripple":0,"jumpCooldown":30,"school":0}]}}""")
    private fun runtime():NativeAnimalRuntime {
        val input=AnimalHabitatInput(listOf(AnimalSurface(-50.0,0.0,-50.0,50.0,0.0,false,true),AnimalSurface(0.0,50.0,-50.0,50.0,0.0,true,false)),emptyList())
        return NativeAnimalRuntime(input,AnimalInitialState.read(state()),1.0)
    }
    private fun camera()=AnimalCamera(doubleArrayOf(0.0,20.0,45.0),doubleArrayOf(0.0,0.0,0.0),60.0,1.5,.1,150.0)
    @Test fun separateRenderersNeverMutateTheSharedPreparedPopulation(){
        val initial=AnimalInitialState.read(state())
        val input=AnimalHabitatInput(listOf(AnimalSurface(-50.0,0.0,-50.0,50.0,0.0,false,true),AnimalSurface(0.0,50.0,-50.0,50.0,0.0,true,false)),emptyList())
        val first=NativeAnimalRuntime(input,initial,1.0);val second=NativeAnimalRuntime(input,initial,1.0)
        try{
            assertNotSame(initial.agents[0],first.community.agents[0]);assertNotSame(first.community.agents[0],second.community.agents[0])
            assertNull(initial.agents[0].walker);assertNotSame(first.community.agents[0].walker,second.community.agents[0].walker)
            assertTrue(first.community.tap(1));var now=1_000_000_000L;repeat(80){first.advance(now,camera(),true);now+=33_000_000}
            assertEquals(0,initial.agents[0].reactions);assertEquals(0,second.community.agents[0].reactions)
            assertEquals(0.0,second.community.time,0.0);assertEquals(0.0,initial.time,0.0)
            val third=NativeAnimalRuntime(input,initial,1.0)
            try{assertEquals(second.community.agents.map{it.position},third.community.agents.map{it.position});assertEquals(0,third.community.agents[0].reactions)}finally{third.close()}
        }finally{first.close();second.close()}
    }
    @Test fun actualThreeSphereFrustumMatchesNativeForWideCloseAndBoundaryViews() {
        val rows=JSONArray(javaClass.getResource("/animal-camera-oracle.json")!!.readText());assertEquals(1176,rows.length())
        for(i in 0 until rows.length()){
            val r=rows.getJSONObject(i);fun v(key:String)=r.getJSONArray(key).let{a->DoubleArray(3){a.getDouble(it)}}
            val p=v("position");val kind=r.getString("kind")
            val a=NativeAnimalAgent(1,if(kind=="bird")"gull" else "sheep",kind,AnimalPoint(p[0],p[1],p[2]),0.0,"rest",1.0,0.0)
            assertEquals("source frustum case $i",r.getBoolean("visible"),AnimalCamera(v("eye"),v("target"),r.getDouble("fov"),r.getDouble("aspect"),r.getDouble("near"),r.getDouble("far")).visible(a))
        }
    }
    @Test fun malformedInitialStateCannotBecomeAnActiveNativeWorld() {
        val valid=AnimalInitialState.read(state());assertEquals(3,valid.agents.size)
        for(change in 0..4){val raw=state();val agents=raw.getJSONObject("community").getJSONArray("agents")
            when(change){0->raw.put("rootRotationY",.2);1->agents.getJSONObject(0).put("route",JSONObject())
                2->agents.getJSONObject(1).put("id",1);3->raw.getJSONObject("community").put("seed",4294967296L)
                4->agents.getJSONObject(0).put("activity","walk")}
            assertThrows(IllegalArgumentException::class.java){AnimalInitialState.read(raw)}
        }
    }
    @Test fun pauseDoesNotAdvanceAnimalsThroughUnobservedBackgroundTime() {
        val runtime=runtime();val camera=camera();var now=1_000_000_000L
        repeat(100){runtime.advance(now,camera,true);now+=33_000_000}
        assertTrue(runtime.updates>2);assertTrue(runtime.community.agents.any{it.traveled>0||it.activity=="fly"})
        runtime.pause();val before=runtime.community.time;runtime.advance(now+600_000_000_000L,camera,true)
        assertEquals(before,runtime.community.time,0.0);runtime.advance(now+600_033_000_000L,camera,true)
        assertEquals(before+.033,runtime.community.time,1e-9);runtime.close()
    }
    @Test fun invalidOwnerUpdateKeepsCollisionAndLiveAgentsWhileValidUpdateReusesNavigation() {
        val runtime=runtime();val world=runtime.habitat.world;val sheep=runtime.community.agents.first();val nav=sheep.walker!!.navigator
        val revision=world.revision;val before=sheep.position
        assertThrows(IllegalArgumentException::class.java){runtime.replaceOwner("house",listOf(AnimalSolid("bad","house",1.0,0.0,0.0,2.0,0.0,1.0)))}
        assertEquals(revision,world.revision);assertEquals(before,sheep.position);assertEquals(0,runtime.ownerReplacements)
        runtime.replaceOwner("house",listOf(AnimalSolid("house:0","house",-11.0,-9.0,0.0,2.0,-1.0,1.0)))
        assertSame(world,runtime.habitat.world);assertSame(nav,sheep.walker!!.navigator);assertEquals(revision+1,world.revision)
        assertTrue(world.clear(sheep.position,nav.body));assertTrue(world.supported(sheep.position,nav.body));assertNull(sheep.walker!!.route)
        runtime.advance(1_000_000_000L,camera(),false);assertTrue(runtime.rig.counts[0]>0);runtime.close()
    }
}
