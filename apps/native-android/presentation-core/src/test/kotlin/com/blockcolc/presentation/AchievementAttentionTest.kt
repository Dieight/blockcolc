package com.blockcolc.presentation

import org.junit.Assert.*
import org.junit.Test

class AchievementAttentionTest {
    private class Store:AchievementReceiptStorage{var data:String?=null;var fail=false;override fun read()=data;override fun write(value:String){if(fail)error("Disk full");data=value}}
    @Test fun historicalBatchIsReservedForStatisticsWhileNewFactsSurviveRestart(){
        val storage=Store();val first=AchievementAttention(storage)
        assertTrue(first.observe("db:0",setOf("focus-first")).isEmpty())
        assertEquals(setOf("time-hour"),first.observe("db:0",setOf("focus-first","time-hour")))
        assertEquals(setOf("time-hour"),AchievementAttention(storage).observe("db:0",setOf("focus-first","time-hour")))
        assertTrue(first.observe("db:1",setOf("focus-first","time-hour","focus-ten")).isEmpty())
    }
    @Test fun failedBaselineSaveCannotPretendToEstablishAnAcknowledgedBaseline(){
        val storage=Store();storage.fail=true;val attention=AchievementAttention(storage)
        assertThrows(IllegalStateException::class.java){attention.observe("db:0",emptySet())}
        assertNull(storage.data);storage.fail=false
        assertTrue(attention.observe("db:0",emptySet()).isEmpty())
        assertEquals(setOf("focus-first"),attention.observe("db:0",setOf("focus-first")))
    }
}
