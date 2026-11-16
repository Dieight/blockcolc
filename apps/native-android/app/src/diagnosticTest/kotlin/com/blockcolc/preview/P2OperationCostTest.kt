package com.blockcolc.preview

import com.blockcolc.storage.SqlDatabase
import com.blockcolc.storage.SqlSession
import org.junit.Assert.*
import org.junit.Test

class P2OperationCostTest {
    private class FakeDb: SqlDatabase {
        var commits=0;var rollbacks=0
        override fun <T> transaction(block:(SqlSession)->T):T {
            try { return block(object:SqlSession{
                override fun execute(sql:String,args:List<Any?>)=1
                override fun query(sql:String,args:List<Any?>)=listOf(listOf<Any?>(1))
            }).also{commits++} }catch(e:Throwable){rollbacks++;throw e}
        }
        override fun close(){}
    }
    @Test fun observesActualTransactionReturnAndKeepsSensitiveArgumentsOut(){
        var clock=0L;val cost=P2OperationCost{++clock};val actual=FakeDb();val measured=P2MeasuredDatabase(actual)
        P2OperationCost.collect(cost){cost.mark("actorStartedNs");measured.transaction{
            it.query("SELECT secret",listOf("private-title"));it.execute("UPDATE state_meta SET revision=?",listOf(2))
        };cost.mark("coordinatorReturnedNs")}
        val row=cost.json().getJSONArray("transactions").getJSONObject(0)
        assertEquals(1,actual.commits);assertEquals(1,row.getInt("queryCalls"));assertEquals(1,row.getInt("writeCalls"));assertTrue(row.getBoolean("facts"));assertTrue(row.getBoolean("ok"))
        assertTrue(row.getString("endNs").toLong()>row.getString("bodyEndNs").toLong())
        assertFalse(cost.json().toString().contains("private-title"));assertNull(P2OperationCost.active())
    }
    @Test fun aFailedTransactionIsNotAcknowledgedAndThreadLocalIsReleased(){
        val actual=FakeDb();val measured=P2MeasuredDatabase(actual);val cost=P2OperationCost()
        assertTrue(runCatching{P2OperationCost.collect(cost){measured.transaction{it.execute("UPDATE state_meta SET revision=1");error("rollback")}}}.isFailure)
        assertFalse(cost.json().getJSONArray("transactions").getJSONObject(0).getBoolean("ok"));assertEquals(0,actual.commits);assertEquals(1,actual.rollbacks);assertNull(P2OperationCost.active())
        measured.transaction{it.query("SELECT 1")};assertEquals(1,cost.json().getJSONArray("transactions").length())
    }
    @Test fun nestedCollectorsAreRejectedWithoutLosingTheOuterScope(){
        val outer=P2OperationCost();P2OperationCost.collect(outer){
            assertTrue(runCatching{P2OperationCost.collect(P2OperationCost()) { error("not reached") }}.isFailure)
            assertSame(outer,P2OperationCost.active())
        };assertNull(P2OperationCost.active())
    }
    @Test fun aNullableResultDoesNotReplayTheMeasuredWork(){
        var calls=0;P2OperationCost.collect(P2OperationCost()){
            assertNull(P2OperationCost.section("nullable"){calls++;null})
        };assertEquals(1,calls)
    }
}
