package com.blockcolc.updates

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.security.MessageDigest

class UpdatePolicyTest {
    @get:Rule val temporary=TemporaryFolder()
    private fun asset()=JSONObject().put("name","Blockcolc-v3.0.0.apk").put("state","uploaded").put("size",10).put("digest","sha256:"+"a".repeat(64))
        .put("browser_download_url","${UpdatePolicy.REPOSITORY}/releases/download/v3.0.0/Blockcolc-v3.0.0.apk")
    private fun release(a:JSONObject=asset())=JSONObject().put("tag_name","v3.0.0").put("draft",false).put("prerelease",false).put("assets",JSONArray().put(a))
    @Test fun stableSourceRequiresExactAssetAndVerifiedDigest(){
        assertNotNull(UpdatePolicy.release(release().toString()).asset)
        for(patch in listOf("name" to "Blockcolc-v3.0.0-private-verification.apk","state" to "new","size" to 1.5,"size" to 0,"digest" to JSONObject.NULL,"browser_download_url" to "https://other.invalid/a")){
            assertNull(UpdatePolicy.release(release(asset().put(patch.first,patch.second)).toString()).asset)
        }
        assertNull(UpdatePolicy.release(release().put("assets",JSONArray().put(asset()).put(asset())).toString()).asset)
    }
    @Test fun malformedDraftAndPreviewReleasesAreRejected(){
        for(body in listOf("{",release().put("prerelease",true).toString(),release().put("draft",true).toString(),release().put("tag_name","v3.0.0-rc1").toString(),release().put("draft","false").toString()))
            assertEquals(UpdateProblem.CHECK,(runCatching{UpdatePolicy.release(body)}.exceptionOrNull() as UpdateFailure).problem)
    }
    @Test fun betaFeedIgnoresDraftsAndOrdersPublishedVersionsNumerically(){
        fun row(version:String,draft:Boolean=false,prerelease:Boolean=UpdatePolicy.isBeta(version)):JSONObject {
            val apk=asset().put("name","Blockcolc-v$version.apk")
                .put("browser_download_url","${UpdatePolicy.REPOSITORY}/releases/download/v$version/Blockcolc-v$version.apk")
            return release(apk).put("tag_name","v$version").put("draft",draft).put("prerelease",prerelease)
        }
        val rows=JSONArray().put(row("3.0.0-beta.2")).put(row("3.0.0-beta.10"))
            .put(row("3.1.0-beta.1",draft=true)).put(row("4.0.0-beta.1",prerelease=false))
        val beta=checkNotNull(UpdatePolicy.betaFeed(rows.toString()))
        assertEquals("3.0.0-beta.10",beta.version)
        assertEquals(beta.version,beta.asset?.version)
        assertEquals("3.0.0",UpdatePolicy.betaFeed(rows.put(row("3.0.0")).toString())?.version)
        assertNull(UpdatePolicy.betaFeed("[]"))
        assertThrows(UpdateFailure::class.java){UpdatePolicy.release(row("3.0.0-beta.1").toString())}
    }
    @Test fun realBytesMustMatchSizeAndDigest(){
        val file=temporary.newFile("update.apk");file.writeText("ten bytes!")
        val sha=UpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(file.readBytes()))
        val descriptor=UpdateAsset("3.0.0",asset().getString("browser_download_url"),file.length(),sha)
        UpdatePolicy.verifyFile(file,descriptor);file.writeText("Ten bytes!")
        assertEquals(UpdateProblem.INTEGRITY,(runCatching{UpdatePolicy.verifyFile(file,descriptor)}.exceptionOrNull() as UpdateFailure).problem)
        file.appendText("extra");assertTrue(runCatching{UpdatePolicy.verifyFile(file,descriptor)}.isFailure)
    }
    @Test fun strictSemanticVersionsAndSignerOrder(){
        assertTrue(UpdatePolicy.compare("3.10.0","3.9.9")>0);assertFalse(UpdatePolicy.isVersion("03.0.0"));assertFalse(UpdatePolicy.isVersion("3.0.0-beta"))
        val descriptor=UpdateAsset("3.0.0",asset().getString("browser_download_url"),10,"a".repeat(64))
        UpdatePolicy.identity(AppIdentity("com.blockcolc.app","3.0.0",105,listOf("b","a")),AppIdentity("com.blockcolc.app","2.9.0",104,listOf("a","b")),descriptor)
    }
    @Test fun cancellationDisconnectsCurrentAndFutureConnections(){
        val token=UpdateCancellation();var calls=0;token.connection{calls++};token.cancel();assertEquals(1,calls)
        token.connection{calls++};assertEquals(2,calls);assertEquals(UpdateProblem.CANCELLED,(runCatching{token.check()}.exceptionOrNull() as UpdateFailure).problem)
    }
}
