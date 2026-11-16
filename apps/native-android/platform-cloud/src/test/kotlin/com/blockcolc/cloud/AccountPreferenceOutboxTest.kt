package com.blockcolc.cloud

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class AccountPreferenceOutboxTest {
    private fun account(id:String)=JSONObject().put("id",id).put("username","synthetic").put("friendsEnabled",false)
        .put("sharing",JSONObject().put("status",false).put("name",false).put("time",false).put("daily",false))
    @Test fun draftIsLocalUntilExitAndUnchangedChoicesDoNotQueue(){
        val base=AccountPreferenceOutbox.editable(account(UUID.randomUUID().toString()))
        val draft=JSONObject(base.toString()).put("friendsEnabled",true)
        assertFalse(base.getBoolean("friendsEnabled"));assertTrue(draft.getBoolean("friendsEnabled"))
        assertEquals(1,AccountPreferenceOutbox.difference(base,draft).length())
        draft.put("friendsEnabled",false);assertEquals(0,AccountPreferenceOutbox.difference(base,draft).length())
    }
    @Test fun pendingSettingsSurviveRecreationWithoutLeakingIntoAnotherAccount(){
        var wire:String?=null;val id=UUID.randomUUID().toString();val other=UUID.randomUUID().toString()
        var outbox=AccountPreferenceOutbox({wire},{wire=it})
        outbox.stage(id,JSONObject().put("friendsEnabled",true))
        outbox=AccountPreferenceOutbox({wire},{wire=it})
        assertTrue(outbox.overlay(account(id)).getBoolean("friendsEnabled"));assertFalse(outbox.overlay(account(other)).getBoolean("friendsEnabled"))
        assertEquals("synthetic",outbox.overlay(account(id)).getString("username"));assertFalse(account(id).getBoolean("friendsEnabled"))
    }
    @Test fun anOldResponseCannotAcknowledgeANewerLocalChoice(){
        var wire:String?=null;val id=UUID.randomUUID().toString();val box=AccountPreferenceOutbox({wire},{wire=it})
        val old=box.stage(id,JSONObject().put("friendsEnabled",true))
        val latest=box.stage(id,JSONObject().put("friendsEnabled",false))
        assertFalse(box.acknowledge(old));assertFalse(JSONObject(box.pending(id)!!.change).getBoolean("friendsEnabled"))
        assertTrue(box.acknowledge(latest));assertNull(wire)
    }
    @Test fun failedTransportKeepsOneMergedPatchAndNoCredentialsCanBeQueued(){
        var wire:String?=null;val id=UUID.randomUUID().toString();val box=AccountPreferenceOutbox({wire},{wire=it})
        box.stage(id,JSONObject().put("friendsEnabled",true))
        val sharing=account(id).getJSONObject("sharing").put("daily",true)
        box.stage(id,JSONObject().put("sharing",sharing))
        val pending=JSONObject(box.pending(id)!!.change);assertTrue(pending.getBoolean("friendsEnabled"));assertTrue(pending.getJSONObject("sharing").getBoolean("daily"))
        try{box.stage(id,JSONObject().put("password","must never be persisted"));fail("Credentials accepted")}catch(_:IllegalArgumentException){}
        assertFalse(checkNotNull(wire).contains("password"))
    }
}
