package com.blockcolc.world.filament

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

class RenderSurfaceLeaseTest {
    @Test fun queuedAcquisitionCannotOutliveDetachment(){
        val lease=RenderSurfaceLease();val ticket=lease.begin();var created=false
        assertFalse(lease.detach())
        assertFalse(lease.acquire(ticket){created=true})
        assertFalse(created);assertNull(lease.frameTicket())
    }
    @Test fun aNewWindowRejectsTheOldQueuedCallbacks(){
        val lease=RenderSurfaceLease();val first=lease.begin();val second=lease.begin()
        assertNotEquals(first,second);assertFalse(lease.isCurrent(first))
        assertFalse(lease.acquire(first){fail("Retired window acquired")})
        assertTrue(lease.acquire(second){})
        assertEquals(second,lease.frameTicket())
    }
    @Test fun detachedFramesStayInvalidEvenIfTheSameSceneReturns(){
        val lease=RenderSurfaceLease();val first=lease.begin();lease.acquire(first){}
        assertTrue(lease.detach());assertNull(lease.frameTicket())
        lease.retire{}
        val second=lease.begin();assertNull(lease.frameTicket())
        lease.acquire(second){}
        assertFalse(lease.isCurrent(first));assertEquals(second,lease.frameTicket())
    }
    @Test fun releaseRunsOnceAndNeverRunsForAnUnacquiredWindow(){
        val lease=RenderSurfaceLease();lease.begin();var releases=0
        assertFalse(lease.retire{releases++})
        lease.acquire(checkNotNull(lease.currentTicket())){}
        assertTrue(lease.detach());assertTrue(lease.retire{releases++})
        assertFalse(lease.retire{releases++});assertFalse(lease.detach());assertEquals(1,releases)
    }
    @Test fun aFailedReleaseDoesNotPretendToHaveReturnedOwnership(){
        val lease=RenderSurfaceLease();lease.acquire(lease.begin()){}
        lease.detach()
        assertThrows(IllegalStateException::class.java){lease.retire{error("Injected release failure")}}
        assertTrue(lease.detach());assertTrue(lease.retire{})
        assertFalse(lease.detach())
    }
    @Test fun detachCannotMissAnAcquisitionAlreadyInsideTheDriverCall(){
        val lease=RenderSurfaceLease();val ticket=lease.begin()
        val creating=CountDownLatch(1);val finishCreate=CountDownLatch(1)
        val result=AtomicReference<Boolean>();val failure=AtomicReference<Throwable>()
        val creator=thread(name="surface-test-create"){
            try{lease.acquire(ticket){creating.countDown();check(finishCreate.await(5,TimeUnit.SECONDS))}}
            catch(error:Throwable){failure.set(error)}
        }
        assertTrue(creating.await(5,TimeUnit.SECONDS))
        val invalidator=thread(name="surface-test-detach"){try{result.set(lease.detach())}catch(error:Throwable){failure.set(error)}}
        try{
            val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
            while(invalidator.state!=Thread.State.BLOCKED&&invalidator.isAlive&&System.nanoTime()<deadline)Thread.yield()
            assertEquals("Detach must observe the in-flight acquisition",Thread.State.BLOCKED,invalidator.state)
        }finally{finishCreate.countDown();creator.join(5000);invalidator.join(5000)}
        assertFalse(creator.isAlive);assertFalse(invalidator.isAlive);assertNull(failure.get())
        assertEquals(true,result.get());assertNull(lease.frameTicket())
        assertTrue(lease.retire{})
    }
}
