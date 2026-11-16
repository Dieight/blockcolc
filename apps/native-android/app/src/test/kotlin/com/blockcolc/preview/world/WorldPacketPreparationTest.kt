package com.blockcolc.preview.world

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class WorldPacketPreparationTest {
    @Test fun failureWaitsForTheOtherChildToStopBeforeTheNextBatchOrClose() {
        val lanes=WorldPacketPreparation(null,true)
        val entered=CountDownLatch(1);val exited=AtomicBoolean()
        val failure=IllegalArgumentException("Root failed")
        try {
            val actual=assertThrows(IllegalArgumentException::class.java){lanes.batch({false}){batch->
                batch.submit{entered.countDown();try{while(!batch.cancelled())Thread.yield()}finally{exited.set(true)}}
                val root=batch.submit<Int>{check(entered.await(5,TimeUnit.SECONDS));throw failure}
                root()
            }}
            assertSame(failure,actual);assertTrue("Clear cannot race an old child",exited.get())
            assertEquals(3,lanes.batch({false}){batch->batch.submit{1}()+batch.submit{2}()})
        }finally{lanes.close()}
    }
    @Test fun anAlreadyCancelledBatchCannotRunAnyChildOrLoseTheCancellation() {
        val lanes=WorldPacketPreparation(null,true);val entered=AtomicBoolean()
        try{assertThrows(java.util.concurrent.CancellationException::class.java){lanes.batch({true}){batch->batch.submit{entered.set(true)}()}}
            assertFalse(entered.get())}
        finally{lanes.close()}
    }
}
