package com.blockcolc.updates

import org.junit.Assert.*
import org.junit.Test

class UpdateSessionTest {
    private val asset=UpdateAsset("3.0.0","${UpdatePolicy.REPOSITORY}/releases/download/v3.0.0/Blockcolc-v3.0.0.apk",10,"a".repeat(64))
    private class Fixture(privateBuild:Boolean=false,packageName:String="com.blockcolc.app",feed:UpdateFeed=UpdateFeed.STABLE) {
        var job:DownloadRecord?=null;var transfers=0;var requests=0;var failed=false;var release:AppRelease?=null;var duringRequest:((UpdateCancellation)->Unit)?=null
        val published=mutableListOf<UpdateView>()
        val session=UpdateSession(UpdateEngine(AppIdentity(packageName,"2.9.0",104,listOf("s"),privateBuild),"2.9.0",
            object:UpdateJobStore {override fun read()=job;override fun write(record:DownloadRecord?){job=record}},
            object:UpdateDownloads {override fun enqueue(token:String,asset:UpdateAsset):Long{transfers++;return transfers.toLong()};override fun query(id:Long)=TransferProgress(TransferPhase.DOWNLOADING);override fun remove(id:Long){}},
            object:UpdateFiles {override fun verify(record:DownloadRecord,force:Boolean)=error("unused");override fun delete(token:String){}},
            object:UpdateInstaller {override fun allowed()=false;override fun authorize(){error("unused")};override fun install(token:String){error("unused")}},feed=feed),
            object:ReleaseSource {override fun latest(cancel:UpdateCancellation):AppRelease{requests++;duringRequest?.invoke(cancel);if(failed)error("network");return checkNotNull(release)}},"2.9.0",{published+=it})
    }
    @Test fun defaultOffDoesNotRequestAndManualNeedsConfirmation(){
        val f=Fixture();f.release=AppRelease("3.0.0","notes",asset);f.session.configure(false,true,true);assertEquals(0,f.requests)
        f.session.check();assertEquals(1,f.requests);assertEquals(0,f.transfers);assertEquals(0L,f.session.view.notice)
        f.session.download(asset);assertEquals(1,f.transfers)
    }
    @Test fun automaticChecksOncePerStartupThenWaitsUntilVisibleAndOperable(){
        val f=Fixture();f.release=AppRelease("3.0.0","notes",asset);f.session.configure(true,false,false);assertEquals(0,f.requests)
        f.session.configure(true,true,false);assertEquals(1,f.requests);assertEquals(0,f.transfers)
        f.session.configure(true,false,true);assertEquals(0,f.transfers)
        f.session.configure(true,true,true);assertEquals(1,f.transfers);assertEquals(1L,f.session.view.notice)
        repeat(5){f.session.configure(true,true,true)};assertEquals(1,f.requests);assertEquals(1,f.transfers)
    }
    @Test fun disabledAutomaticPreferenceDropsPendingDownload(){
        val f=Fixture();f.release=AppRelease("3.0.0","notes",asset);f.session.configure(true,true,false)
        f.session.configure(false,true,true);f.session.configure(true,true,true);assertEquals(1,f.requests);assertEquals(0,f.transfers)
    }
    @Test fun automaticOfflineAndCurrentVersionAreSilent(){
        val f=Fixture();f.failed=true;f.session.configure(true,true,true);assertNull(f.session.view.problem);assertEquals(0L,f.session.view.notice)
        f.failed=false;f.release=AppRelease("2.9.0","notes",null);f.session.check();assertTrue(f.session.view.checked);assertNull(f.session.view.release);assertEquals(0,f.transfers)
    }
    @Test fun manualFailureCanBeRetriedAndCancelledCheckIsNotAdopted(){
        val f=Fixture();f.failed=true;f.session.check();assertEquals(UpdateProblem.CHECK,f.session.view.problem)
        f.failed=false;f.release=AppRelease("3.0.0","notes",asset);f.duringRequest={f.session.cancelCheck()};f.session.check()
        assertNull(f.session.view.release);assertFalse(f.session.view.checking);assertEquals(0,f.transfers)
        f.duringRequest=null;f.session.check();assertEquals("3.0.0",f.session.view.release!!.version)
    }
    @Test fun privateAndPreviewOnlyNotifyEvenWhenAutomaticDownloadWasRequested(){
        for(f in listOf(Fixture(privateBuild=true),Fixture(packageName="com.blockcolc.preview"))){
            f.release=AppRelease("3.0.0","notes",asset);f.session.configure(true,true,true)
            assertEquals(1L,f.session.view.notice);assertEquals(0,f.transfers)
            f.session.download(asset);assertEquals(UpdateProblem.CHANNEL,f.session.view.problem);assertEquals(0,f.transfers)
        }
    }
    @Test fun unverifiableAssetStillHasReleaseNotesButNeverDownloads(){
        val f=Fixture();f.release=AppRelease("3.0.0","notes",null);f.session.configure(true,true,true)
        assertEquals("notes",f.session.view.release!!.url);assertEquals(1L,f.session.view.notice);assertEquals(0,f.transfers)
    }
    @Test fun betaManualStillConfirmsAndAutomaticCanDownloadForTheFormalIdentity(){
        val beta=asset.copy(version="3.0.0-beta.1",url="${UpdatePolicy.REPOSITORY}/releases/download/v3.0.0-beta.1/Blockcolc-v3.0.0-beta.1.apk")
        val release=AppRelease(beta.version,"notes",beta)
        val manual=Fixture(feed=UpdateFeed.BETA)
        manual.release=release
        manual.session.check()
        assertEquals(0,manual.transfers)
        manual.session.download(beta)
        assertEquals(beta,manual.job?.asset)
        val automatic=Fixture(feed=UpdateFeed.BETA)
        automatic.release=release
        automatic.session.configure(true,true,true)
        assertEquals(beta,automatic.job?.asset)
        val stable=Fixture()
        stable.session.download(beta)
        assertEquals(UpdateProblem.CHANNEL,stable.session.view.problem)
        assertEquals(0,stable.transfers)
        stable.job=manual.job
        stable.session.refresh()
        assertNull(stable.job)
    }
}
