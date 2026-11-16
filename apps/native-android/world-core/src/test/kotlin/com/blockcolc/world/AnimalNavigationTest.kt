package com.blockcolc.world

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class AnimalNavigationTest {
    @Test fun colliderLookupHandlesCollidingIdFamiliesRepeatedRemovalAndOwnerTransfers(){
        val names=List(2048){n->buildString{repeat(11){bit->append(if(n and(1 shl bit)==0)"Aa"else"BB")}}}
        assertEquals(1,names.map{it.hashCode()}.distinct().size)
        val world=AnimalCollisionWorld(AnimalBounds(-10.0,200.0,-10.0,200.0))
        val all=AnimalBounds(-1.0,140.0,-1.0,30.0)
        repeat(6){pass->
            val subset=names.filterIndexed{i,_->i%3!=pass%3}
            val values=subset.mapIndexed{i,id->AnimalSolid(id,"forest",(i%128).toDouble(),(i%128+1).toDouble(),0.0,2.0,(i/128).toDouble(),(i/128+1).toDouble())}
            world.replaceOwner("forest",values)
            assertEquals(subset.toSet(),world.query(all).map{it.id}.toSet())
            assertEquals(subset.size.toLong(),world.stats().getValue("solids"))
            val selected=values.first();val before=world.stats()
            assertThrows(IllegalArgumentException::class.java){world.replaceOwner("other",listOf(selected.copy(owner="other")))}
            assertEquals(before,world.stats())
            world.prepareOwners(linkedMapOf("forest" to values.drop(1),"other" to listOf(selected.copy(owner="other")))).commit()
            assertEquals("other",world.query(all).single{it.id==selected.id}.owner)
            world.replaceOwner("other",emptyList())
        }
    }
    @Test fun rectangularBinDeduplicationKeepsTheOriginalOrderedQueryAcrossBoundaries(){
        val source=List(80){i->
            val x=(i%10-5)*4.0;val z=(i/10-4)*4.0
            AnimalSolid("solid-$i","initial",x,x+if(i%7==0)24.0 else 1.0,0.0,2.0,z,z+if(i%9==0)24.0 else 1.0)
        }
        for(strict in listOf(false,true)){
            val margin=if(strict)0.0 else .0001
            fun bins(b:AnimalFootprint):List<Pair<Int,Int>>{
                val out=ArrayList<Pair<Int,Int>>()
                for(z in floor(b.minZ/8).toInt()..floor((b.maxZ-margin)/8).toInt())
                    for(x in floor(b.minX/8).toInt()..floor((b.maxX-margin)/8).toInt())out+=x to z
                return out
            }
            val buckets=linkedMapOf<Pair<Int,Int>,MutableList<AnimalSolid>>()
            for(s in source)for(k in bins(s))buckets.getOrPut(k){ArrayList()}.add(s)
            val world=AnimalCollisionWorld(AnimalBounds(-100.0,100.0,-100.0,100.0),source,strictSourceOverlap=strict)
            val random=java.util.Random(33029)
            repeat(400){i->
                val x=if(i%4==0)(i%9-4)*8.0 else random.nextDouble()*64-32
                val z=if(i%5==0)(i%9-4)*8.0 else random.nextDouble()*64-32
                val b=AnimalBounds(x,x+if(i%3==0)16.0 else .01,z,z+if(i%6==0)16.0 else 1.0)
                // Former source algorithm: visit bins in order, deduplicate
                // IDs, then filter. This oracle deliberately uses no first-bin
                // predicate from the optimized implementation.
                val seen=linkedSetOf<String>();val expected=ArrayList<AnimalSolid>()
                for(k in bins(b))for(s in buckets[k].orEmpty())if(seen.add(s.id))expected+=s
                val filtered=expected.filter{s->s.minX<b.maxX-margin&&s.maxX>b.minX+margin&&s.minZ<b.maxZ-margin&&s.maxZ>b.minZ+margin}
                assertEquals("strict=$strict query=$i",filtered,world.query(b))
            }
        }
    }
    private fun oracle()=JSONObject(javaClass.getResource("/animal-navigation-oracle.json")!!.readText())
    private fun point(v:JSONObject)=AnimalPoint(v.getDouble("x"),v.getDouble("y"),v.getDouble("z"))
    private fun bounds(v:JSONObject)=AnimalBounds(v.getDouble("minX"),v.getDouble("maxX"),v.getDouble("minZ"),v.getDouble("maxZ"))
    private fun body(v:JSONObject)=AnimalBodies.all.single{it.id==v.getString("id")}
    private fun solids(v:JSONObject)=v.getJSONArray("solids").let{rows->List(rows.length()){i->val r=rows.getJSONObject(i)
        AnimalSolid(r.getString("id"),r.getString("owner"),r.getDouble("minX"),r.getDouble("maxX"),r.getDouble("minY"),r.getDouble("maxY"),r.getDouble("minZ"),r.getDouble("maxZ"),r.optBoolean("water"),r.optBoolean("walkable",true))}}
    private fun same(expected:JSONObject,actual:AnimalPoint){assertEquals(expected.getDouble("x"),actual.x,1e-8);assertEquals(expected.getDouble("y"),actual.y,1e-8);assertEquals(expected.getDouble("z"),actual.z,1e-8)}
    @Test fun currentProductionRoutesMatchForFourBodiesStepsCliffsWaterGapsAndLedges() {
        val cases=oracle().getJSONArray("routes");assertEquals(28,cases.length())
        for(i in 0 until cases.length()){
            val v=cases.getJSONObject(i);val nav=AnimalNavigator(AnimalCollisionWorld(bounds(v.getJSONObject("bounds")),solids(v)),body(v.getJSONObject("body")),1.0,1024)
            val actual=nav.plan(point(v.getJSONObject("start")),point(v.getJSONObject("goal")),v.getInt("budget"));val e=v.getJSONObject("output")
            assertEquals("case $i ${v.getString("layout")}",e.getString("reason"),actual.reason)
            assertEquals(e.getInt("expanded"),actual.expanded);val points=e.getJSONArray("points");assertEquals(points.length(),actual.points.size)
            for(j in 0 until points.length())same(points.getJSONObject(j),actual.points[j])
            assertEquals((0 until e.getJSONArray("actions").length()).map{e.getJSONArray("actions").getString(it)},actual.actions)
        }
    }
    @Test fun liftCrossAndLandChoreographyMatchesSourceInsteadOfLerpingThroughSteps() {
        val rows=oracle().getJSONArray("edges");assertEquals(144,rows.length())
        for(i in 0 until rows.length()){
            val v=rows.getJSONObject(i);val a=point(v.getJSONObject("a"));val b=point(v.getJSONObject("b"));val body=body(v.getJSONObject("body"))
            assertEquals(v.getString("action"),animalEdgeAction(a,b,body));same(v.getJSONObject("point"),animalEdgePoint(a,b,v.getDouble("t"),body))
        }
    }
    @Test fun curvedVariableSpeedWalksReactionsAndOwnerChangesMatchAllSourceSteps() {
        val rows=oracle().getJSONArray("walkers");assertEquals(8,rows.length())
        for(i in 0 until rows.length()){
            val v=rows.getJSONObject(i);val world=AnimalCollisionWorld(bounds(v.getJSONObject("bounds")),solids(v));val walker=AnimalWalker(AnimalNavigator(world,body(v.getJSONObject("body")),1.0,1024),point(v.getJSONObject("start")))
            walker.setTarget(point(v.getJSONObject("goal")));val frames=v.getJSONArray("frames")
            for(j in 0 until frames.length()){
                val f=frames.getJSONObject(j);if(j==5)walker.tap()
                if(v.getBoolean("edit")&&j==80)world.replaceOwner("edit",listOf(AnimalSolid("new-wall","fixture",2.0,3.0,0.0,3.0,-1.5,1.5)))
                walker.speedScale=1+sin(j/11.0)*.2;walker.curve=sin(j/27.0)*.2;walker.update(f.getDouble("dt"))
                same(f.getJSONObject("position"),walker.position)
                for((key,actual) in listOf("heading" to walker.heading,"traveled" to walker.traveled,"reactionRemaining" to walker.reactionRemaining,"droppedSeconds" to walker.droppedSeconds))assertEquals("actor $i frame $j $key",f.getDouble(key),actual,1e-8)
                assertEquals(f.getBoolean("moving"),walker.moving);assertEquals(f.getInt("replans"),walker.replans);assertEquals(f.getInt("blocked"),walker.blocked)
            }
        }
    }
    @Test fun onlyAffectedBinsInvalidateAndRejectedReplacementLeavesTheOldWorld() {
        val world=AnimalCollisionWorld(AnimalBounds(-50.0,50.0,-50.0,50.0))
        val near=AnimalBounds(-1.0,1.0,-1.0,1.0);val far=AnimalBounds(30.0,31.0,30.0,31.0);val oldFar=world.stamp(far);val oldNear=world.stamp(near)
        world.replaceOwner("a",listOf(AnimalSolid("a:0","a",-.5,.5,0.0,2.0,-.5,.5)))
        assertEquals(oldFar,world.stamp(far));assertNotEquals(oldNear,world.stamp(near))
        val stats=world.stats();val stamp=world.stamp(near)
        assertThrows(IllegalArgumentException::class.java){world.replaceOwner("b",listOf(AnimalSolid("a:0","b",-.5,.5,0.0,2.0,-.5,.5)))}
        assertEquals(stats,world.stats());assertEquals(stamp,world.stamp(near))
    }
    @Test fun incrementalSearchCancelsOnAStaleCollisionRevision() {
        val world=AnimalCollisionWorld(AnimalBounds(-8.0,8.0,-8.0,8.0),listOf(AnimalSolid("floor","ground",-8.0,8.0,-2.0,0.0,-8.0,8.0)))
        val nav=AnimalNavigator(world,AnimalBodies.SHEEP);val search=nav.search(AnimalPoint(-4.0,0.0,0.0),AnimalPoint(4.0,0.0,0.0))
        assertFalse(search.advance(1,Long.MAX_VALUE));assertNull(search.result)
        world.replaceOwner("changed",emptyList());assertTrue(search.advance());assertEquals("cancelled",search.result!!.reason)
        assertTrue(nav.stats().getValue("columns")<=nav.cacheLimit)
    }
    @Test fun multiOwnerCollisionTicketsValidateTheCompleteCandidateAndCommitOnlyOnce(){
        val world=AnimalCollisionWorld(AnimalBounds(-50.0,50.0,-50.0,50.0))
        fun solid(id:String,owner:String,x:Double)=AnimalSolid(id,owner,x,x+1,0.0,2.0,0.0,1.0)
        world.replaceOwner("a",listOf(solid("shared","a",0.0)));world.replaceOwner("b",listOf(solid("b:0","b",16.0)))
        val far=AnimalBounds(40.0,41.0,40.0,41.0);val farStamp=world.stamp(far);val before=world.stats()
        assertThrows(IllegalArgumentException::class.java){world.prepareOwners(linkedMapOf("a" to emptyList(),"b" to listOf(solid("duplicate","b",2.0),solid("duplicate","b",3.0))))}
        assertEquals(before,world.stats())
        // An identifier can move between owners in the same atomic candidate.
        val ticket=world.prepareOwners(linkedMapOf("a" to emptyList(),"b" to listOf(solid("shared","b",8.0))))
        assertEquals(before,world.stats());val revision=world.revision;ticket.commit()
        assertEquals(revision+1,world.revision);assertEquals(farStamp,world.stamp(far))
        assertTrue(world.query(AnimalBounds(-.1,1.1,-.1,1.1)).isEmpty())
        assertEquals("b",world.query(AnimalBounds(7.9,9.1,-.1,1.1)).single().owner)
        assertThrows(IllegalStateException::class.java){ticket.commit()}
        val stale=world.prepareOwners(mapOf("a" to listOf(solid("a:1","a",0.0))));world.replaceOwner("b",emptyList())
        val after=world.stats();assertThrows(IllegalStateException::class.java){stale.commit()};assertEquals(after,world.stats())
    }
    @Test fun denseSharedBinsKeepStableQueryOrderAndOtherOwnersDuringReplacement(){
        val world=AnimalCollisionWorld(AnimalBounds(-16.0,16.0,-16.0,16.0))
        fun rows(owner:String,count:Int)=List(count){i->AnimalSolid("$owner:$i",owner,.5,1.5,i*2.0,i*2.0+1,.5,1.5)}
        val a=rows("a",4000);val b=rows("b",4000)
        world.replaceOwner("a",a);world.replaceOwner("b",b)
        val area=AnimalBounds(.1,2.0,.1,2.0)
        assertEquals((a+b).map{it.id},world.query(area).map{it.id})
        val far=world.stamp(AnimalBounds(10.0,11.0,10.0,11.0))
        val next=rows("a",3000);val before=world.stats()
        val ticket=world.prepareOwners(mapOf("a" to next))
        assertEquals(before,world.stats())
        ticket.commit()
        assertEquals((b+next).map{it.id},world.query(area).map{it.id})
        assertEquals(far,world.stamp(AnimalBounds(10.0,11.0,10.0,11.0)))
        val stable=world.stats()
        assertThrows(IllegalArgumentException::class.java){world.prepareOwners(mapOf("a" to listOf(b.first())))}
        assertEquals(stable,world.stats())
        world.replaceOwner("a",emptyList())
        assertEquals(b,world.query(area))
    }
}
