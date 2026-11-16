package com.blockcolc.preview

import com.blockcolc.preview.ui.NativeRequest
import org.junit.Assert.*
import org.junit.Test

class NativeRequestTest {
    @Test fun pendingReceiptSurvivesActivityRecreationButNotTheDeathOfItsProcess(){
        val request=NativeRequest();var sent:String?=null
        request.submit{sent=it};assertNotNull(sent);assertTrue(request.busy)
        assertEquals(sent,NativeRequest.restore(request.savedState()).pending)
        val old=request.savedState().toMutableList().also{it[2]="a-different-process"}
        assertFalse(NativeRequest.restore(old).busy)
        assertFalse(NativeRequest.restore(listOf("old-request","failure")).busy)
        assertEquals("failure",NativeRequest.restore(listOf("old-request","failure")).error)
    }
    @Test fun aPendingActionDoesNotReenterAndFailureCanRetryWithANewId(){
        val request=NativeRequest();val ids=arrayListOf<String>()
        request.submit{ids.add(it)};request.submit{ids.add(it)};assertEquals(1,ids.size)
        request.finish(false,"disk");assertEquals("disk",request.error);assertFalse(request.busy)
        request.submit{ids.add(it)};assertEquals(2,ids.size);assertNotEquals(ids[0],ids[1]);assertNull(request.error)
        request.finish(true,null);assertFalse(request.busy);assertNull(request.error)
    }
}
