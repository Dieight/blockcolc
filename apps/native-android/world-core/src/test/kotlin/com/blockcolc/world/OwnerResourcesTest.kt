package com.blockcolc.world

import org.junit.Assert.*
import org.junit.Test

class OwnerResourcesTest {
    @Test fun weatherOwnersPublishAtomicallyAndSnapshotCallerTickets() {
        val retired=mutableListOf<String>();val cloud=PacketOwners.CLOUDS;val rain=PacketOwners.PRECIPITATION
        val store=OwnerResources(mapOf("world" to listOf("land"),cloud to listOf("old-cloud"),rain to listOf("old-rain")),retired::add)
        val tickets=linkedMapOf(cloud to store.token(cloud)!!,rain to store.token(rain)!!);val before=tickets.toMap()
        assertTrue(store.replaceMany(tickets,{owner,staged->staged+="new-$owner";tickets.clear()},{old,next->
            assertEquals(before.keys,old.keys);assertEquals(before.keys,next.keys)
            assertEquals(listOf("old-cloud"),store.snapshot()[cloud]);assertEquals(before[rain],store.token(rain))
        }).accepted)
        assertEquals(listOf("old-rain","old-cloud"),retired);assertEquals(listOf("land"),store.snapshot()["world"])
        for((owner,token)in before)assertEquals(token.copy(revision=token.revision+1),store.token(owner))
        assertFalse(store.replaceMany(before,{_,_->error("stale allocated")},{_,_->error("stale published")}).accepted)
    }
    @Test fun secondWeatherUploadFailureKeepsBothOldOwnersAndDisposesStagedResources() {
        val retired=mutableListOf<String>();val cloud=PacketOwners.CLOUDS;val rain=PacketOwners.PRECIPITATION
        val store=OwnerResources(mapOf(cloud to listOf("old-cloud"),rain to listOf("old-rain")),retired::add)
        val tokens=listOf(cloud,rain).associateWith{store.token(it)!!};val before=store.snapshot()
        try{store.replaceMany(tokens,{owner,staged->staged+=owner;if(owner==rain)error("rain upload failed")},{_,_->error("partial publish")});fail()}
        catch(error:IllegalStateException){assertEquals("rain upload failed",error.message)}
        assertEquals(listOf(rain,cloud),retired);assertEquals(before,store.snapshot());assertEquals(tokens,tokens.keys.associateWith{store.token(it)})
        assertTrue(store.replaceMany(tokens,{owner,staged->staged+=owner},{_,_->}).accepted)
    }
    @Test fun staleMemberPreventsAllocationOfTheEntireWeatherGroup() {
        val cloud=PacketOwners.CLOUDS;val rain=PacketOwners.PRECIPITATION
        val store=OwnerResources(mapOf(cloud to listOf(1),rain to listOf(2))){_:Int->}
        val tokens=listOf(cloud,rain).associateWith{store.token(it)!!}
        assertTrue(store.replace(cloud,tokens.getValue(cloud),{it+=3},{_,_->}).accepted)
        assertFalse(store.replaceMany(tokens,{_,_->error("stale group allocated")},{_,_->}).accepted)
        assertEquals(tokens[rain],store.token(rain));assertEquals(listOf(2),store.snapshot()[rain])
        val current=tokens.keys.associateWith{store.token(it)!!};val before=store.snapshot()
        try{store.replaceMany(current,{_,staged->staged+=4},{_,_->error("attachment failed")});fail()}catch(_:IllegalStateException){}
        assertEquals(before,store.snapshot());assertEquals(current,current.keys.associateWith{store.token(it)})
    }
    @Test fun commitReplacesOnlyOneOwnerAndAdvancesExactlyOnce() {
        val retired=mutableListOf<String>()
        val other=listOf("world-vbo", "building-b")
        val store=OwnerResources(mapOf("world" to listOf(other[0]),"building:a" to listOf("old-a"),"building:b" to listOf(other[1])),retired::add)
        val token=store.token("building:a")!!
        assertTrue(store.replace("building:a",token,{it+="new-a"},{old,new->assertEquals(listOf("old-a"),old);assertEquals(listOf("new-a"),new)}).accepted)
        assertEquals(listOf("old-a"),retired)
        assertEquals(listOf("world-vbo"),store.snapshot()["world"]);assertEquals(listOf("building-b"),store.snapshot()["building:b"])
        assertEquals(OwnerToken(token.generation,1),store.token("building:a"))
        assertFalse(store.replace("building:a",token,{error("stale allocated")},{_,_->error("stale published")}).accepted)
    }
    @Test fun failedStagingRetiresEveryStagedResourceAndKeepsOldWorld() {
        val retired=mutableListOf<String>();val store=OwnerResources(mapOf("building:a" to listOf("old")),retired::add)
        val token=store.token("building:a")!!
        try {store.replace("building:a",token,{it+="first";it+="second";error("upload failed")},{_,_->error("must not publish")});fail()}
        catch(error:IllegalStateException){assertEquals("upload failed",error.message)}
        assertEquals(listOf("second","first"),retired);assertEquals(listOf("old"),store.snapshot()["building:a"]);assertEquals(token,store.token("building:a"))
    }
    @Test fun failedPublicationDoesNotAdvanceRevision() {
        val retired=mutableListOf<Int>();val store=OwnerResources(mapOf("building:a" to listOf(1)),retired::add)
        val token=store.token("building:a")!!
        try {store.replace("building:a",token,{it+=2},{_,_->error("scene rejected")});fail()}catch(_:IllegalStateException){}
        assertEquals(listOf(2),retired);assertEquals(listOf(1),store.snapshot()["building:a"]);assertEquals(token,store.token("building:a"))
    }
    @Test fun retirementFailureIsCommittedNotReplayable() {
        val store=OwnerResources(mapOf("building:a" to listOf(1))){value:Int->if(value==1)error("retire failed")}
        val token=store.token("building:a")!!
        val result=store.replace("building:a",token,{it+=2},{_,_->})
        assertTrue(result.accepted);assertEquals(1,result.retirementErrors);assertEquals(listOf(2),store.snapshot()["building:a"])
        assertFalse(store.replace("building:a",token,{error("not replayable")},{_,_->}).accepted)
    }
    @Test fun wrongOwnerAndClosedTokensNeverAllocate() {
        val store=OwnerResources(mapOf("world" to listOf(1),"building:a" to listOf(2))){_:Int->}
        assertFalse(store.replace("building:missing",OwnerToken(0,0),{error("unknown allocated")},{_,_->}).accepted)
        try {store.replace("world",OwnerToken(0,0),{error("global allocated")},{_,_->});fail()}catch(_:IllegalArgumentException){}
        val token=store.token("building:a")!!;assertEquals(0,store.close());assertNull(store.token("building:a"))
        assertFalse(store.replace("building:a",token,{error("closed allocated")},{_,_->}).accepted);assertEquals(0,store.close())
    }
    @Test fun sharedResourcesSurviveAReplacementAndAreDestroyedExactlyOnce() {
        val destroyed=mutableListOf<String>();val pool=ResourcePool<String,String>(destroyed::add)
        val a=pool.acquire("cube"){"vbo"};assertEquals(a,pool.acquire("cube"){error("recreated")})
        assertEquals(2,pool.snapshot()["cube"]!!.second)
        pool.release("cube");assertTrue(destroyed.isEmpty());assertEquals(1,pool.snapshot()["cube"]!!.second)
        pool.release("cube");assertEquals(listOf("vbo"),destroyed);assertTrue(pool.snapshot().isEmpty());assertEquals(1,pool.created);assertEquals(1,pool.destroyed)
        try{pool.release("cube");fail()}catch(_:IllegalStateException){}
    }
    @Test fun failedFactoryDoesNotPublishAPoolEntry() {
        val pool=ResourcePool<String,Int>{}
        try {pool.acquire("bad"){error("create failed")};fail()}catch(_:IllegalStateException){}
        assertTrue(pool.snapshot().isEmpty());assertEquals(0,pool.created)
    }
    @Test fun tokenFromAnEarlierWorldCannotUpdateANewWorldWithTheSameOwner() {
        val earlier=OwnerResources(mapOf("building:a" to listOf(1))){_:Int->}
        val token=earlier.token("building:a")!!;earlier.close()
        val later=OwnerResources(mapOf("building:a" to listOf(2))){_:Int->}
        assertNotEquals(token,later.token("building:a"))
        assertFalse(later.replace("building:a",token,{error("old world allocated")},{_,_->}).accepted)
        assertEquals(listOf(2),later.snapshot()["building:a"])
    }
}
