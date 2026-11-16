package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.StrictJson
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CloudWorkspaceTest {
    @get:Rule val temporary=TemporaryFolder()
    private fun state(name:String)=DomainDocument.fromJson(JSONObject(javaClass.getResource("/state-oracle.json")!!.readText()).getJSONObject("states").getJSONObject(name))
    @Test fun roundTripPreservesFactsAndDeduplicatesBlueprints(){
        for(name in listOf("empty","resource","notes","active","allocation","birthday-reward","habit-monument")){
            val original=state(name);val cloud=CloudWorkspace.split(original)
            assertEquals(original.sha256,CloudWorkspace.join(cloud.entries){cloud.assets.getValue(it)}.sha256)
            assertTrue(cloud.entries.values.none{it.contains("\$nativeAsset")})
            assertTrue(cloud.assets.all{StrictJson.sha(it.value)==it.key})
        }
    }
    @Test fun deltaKeepsUnknownRemoteAdditionsAndExpressesDeletes(){
        val baseline=mapOf("quickNotes/a" to StrictJson.sha("old"),"quickNotes/b" to StrictJson.sha("gone"))
        val changes=CloudWorkspace.changes(mapOf("quickNotes/a" to "new"),baseline).associateBy{it.getString("key")}
        assertEquals(2,changes.size);assertEquals(StrictJson.sha("old"),changes.getValue("quickNotes/a").getString("before"));assertTrue(changes.getValue("quickNotes/b").isNull("canonical"))
    }
    @Test fun adoptionAndBaselineRollBackTogetherAfterInjectedFailure(){
        JdbcStateDatabase(temporary.root.toPath().resolve("state.db")).use{db->
            var fail=false;val store=NativeStateStore(db){if(fail&&it=="before-commit")throw IllegalStateException("disk failure")}
            val initial=store.initialize(state("empty"));val domain=state("notes")
            val baseline=CloudBaseline("account","epoch",1,CloudWorkspace.split(domain).hashes)
            fail=true
            assertThrows(IllegalStateException::class.java){store.adoptCloud(initial.token,"cloud-failed",domain,RecoveryContext(),baseline)}
            assertEquals(initial.domain.sha256,store.load()!!.domain.sha256);assertNull(store.cloudBaseline("account"))
            fail=false;store.adoptCloud(initial.token,"cloud-success",domain,RecoveryContext(),baseline)
            assertEquals(domain.sha256,store.load()!!.domain.sha256);assertEquals(baseline,store.cloudBaseline("account"))
        }
    }
    @Test fun alteredAssetCannotBeAdopted(){val cloud=CloudWorkspace.split(state("resource"));assertTrue(cloud.assets.isNotEmpty())
        assertThrows(IllegalArgumentException::class.java){CloudWorkspace.join(cloud.entries){"{}"}}
    }
}
