package com.blockcolc.world.filament

import org.junit.Assert.*
import org.junit.Test

class RenderTargetStateTest {
    private class Target(val id:Int)
    @Test fun prepareAndRollbackKeepThePreviousGenerationAlive(){
        val retired=mutableListOf<Int>();var binding:Target?=null
        val state=RenderTargetState<Int,Target>({Target(it)},{binding=it},{retired+=it.id})
        state.prepare(1).also{it.commit();it.finish()};val first=state.current
        val next=state.prepare(2);assertSame(first,binding);assertTrue(retired.isEmpty())
        next.commit();assertEquals(2,binding!!.id);assertTrue(retired.isEmpty())
        next.rollback();assertSame(first,binding);assertSame(first,state.current);assertEquals(listOf(2),retired)
        state.close();assertNull(binding);assertEquals(listOf(2,1),retired)
    }
    @Test fun bindingFailureRestoresTheOldTargetAndRetiresOnlyStaging(){
        val retired=mutableListOf<Int>();var binding:Target?=null
        val state=RenderTargetState<Int,Target>({Target(it)},{binding=it;if(it?.id==2)error("bind")},{retired+=it.id})
        state.prepare(1).also{it.commit();it.finish()}
        assertThrows(IllegalStateException::class.java){state.prepare(2).commit()}
        assertEquals(1,binding!!.id);assertSame(binding,state.current);assertEquals(listOf(2),retired)
        state.prepare(3).also{it.commit();assertEquals(0,it.finish())};assertEquals(listOf(2,1),retired)
        assertEquals(3,binding!!.id);state.close()
    }
    @Test fun failedPreparationAndDiscardNeverPublishAndPendingOrClosedTicketsCannotBeReused(){
        val retired=mutableListOf<Int>();var binding:Target?=null
        val state=RenderTargetState<Int,Target>({check(it!=0);Target(it)},{binding=it},{retired+=it.id})
        assertThrows(IllegalStateException::class.java){state.prepare(0)}
        val next=state.prepare(1)
        assertThrows(IllegalStateException::class.java){state.prepare(2)}
        next.discard();next.discard();assertNull(binding);assertEquals(listOf(1),retired)
        val stale=state.prepare(3);state.close();assertEquals(listOf(1,3),retired)
        assertThrows(IllegalStateException::class.java){stale.commit()}
        assertThrows(IllegalStateException::class.java){state.prepare(4)}
    }
    @Test fun retirementFailureDoesNotTurnAnAdoptedConfigurationIntoAFailedCommit(){
        var binding:Target?=null
        val state=RenderTargetState<Int,Target>({Target(it)},{binding=it},{if(it.id==1)error("retire")})
        state.prepare(1).also{it.commit();it.finish()}
        state.prepare(2).also{it.commit();assertEquals(1,it.finish())}
        assertEquals(2,binding!!.id);assertSame(binding,state.current);assertEquals(0,state.close())
    }
    @Test fun closeDetachesBothGenerationsAfterFailedRollback(){
        val retired=mutableListOf<Int>();var fail=false;var binding:Target?=null
        val state=RenderTargetState<Int,Target>({Target(it)},{if(fail&&it?.id==1)error("rollback");binding=it},{retired+=it.id})
        state.prepare(1).also{it.commit();it.finish()};val next=state.prepare(2);next.commit();fail=true
        assertThrows(IllegalStateException::class.java){next.rollback()};assertEquals(2,binding!!.id);assertTrue(retired.isEmpty())
        assertEquals(0,state.close());assertNull(binding);assertEquals(setOf(1,2),retired.toSet())
    }
    @Test fun failedCommitAndFailedRestorationRetainBothTargetsUntilClose(){
        var fail=false;var binding:Target?=null;val retired=mutableListOf<Int>()
        val state=RenderTargetState<Int,Target>({Target(it)},{binding=it;if(fail&&it!=null)error("bind")},{retired+=it.id})
        state.prepare(1).also{it.commit();it.finish()};fail=true
        val failure=assertThrows(IllegalStateException::class.java){state.prepare(2).commit()}
        assertEquals(1,failure.suppressed.size);assertTrue(retired.isEmpty())
        assertEquals(0,state.close());assertNull(binding);assertEquals(setOf(1,2),retired.toSet())
    }
}
