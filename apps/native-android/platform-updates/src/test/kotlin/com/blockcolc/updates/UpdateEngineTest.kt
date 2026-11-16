package com.blockcolc.updates

import org.junit.Assert.*
import org.junit.Test

class UpdateEngineTest {
    private val asset=UpdateAsset("3.0.0","${UpdatePolicy.REPOSITORY}/releases/download/v3.0.0/Blockcolc-v3.0.0.apk",10,"a".repeat(64))
    private val installed=AppIdentity("com.blockcolc.app","2.9.0",104,listOf("signer"))
    private class Store:UpdateJobStore { var value:DownloadRecord?=null;var fail=false
        override fun read()=value
        override fun write(record:DownloadRecord?){if(fail)throw UpdateFailure(UpdateProblem.STORAGE);value=record}}
    private class Downloads:UpdateDownloads {var starts=0;val removed=mutableListOf<Long>();var progress=TransferProgress(TransferPhase.DOWNLOADING,4,10)
        override fun enqueue(token:String,asset:UpdateAsset):Long{starts++;return starts.toLong()}
        override fun query(id:Long)=progress
        override fun remove(id:Long){removed+=id}}
    private class Files(var candidate:AppIdentity):UpdateFiles {val verifies=mutableListOf<Boolean>();val deleted=mutableListOf<String>();var fail=false;var failForce=false
        override fun verify(record:DownloadRecord,force:Boolean):AppIdentity{verifies+=force;if(fail||(force&&failForce))throw UpdateFailure(UpdateProblem.INTEGRITY);return candidate}
        override fun delete(token:String){deleted+=token}}
    private class Installer:UpdateInstaller {var permit=false;var authorizations=0;val installs=mutableListOf<String>()
        override fun allowed()=permit
        override fun authorize(){authorizations++}
        override fun install(token:String){installs+=token}}
    private class Fixture(val installed:AppIdentity){val store=Store();val downloads=Downloads();val files=Files(installed.copy(version="3.0.0",code=105));val installer=Installer()
        fun engine()=UpdateEngine(installed,"2.9.0",store,downloads,files,installer){"b".repeat(32)}}
    private fun reject(problem:UpdateProblem,block:()->Unit){try{block();fail("Expected $problem")}catch(error:UpdateFailure){assertEquals(problem,error.problem)}}

    @Test fun transferSurvivesRecreatedEngineAndKeepsOneSystemJob(){
        val f=Fixture(installed);val first=f.engine().start(asset)
        assertEquals(UpdatePhase.DOWNLOADING,first.phase);assertEquals(4L,first.received)
        assertEquals(UpdatePhase.DOWNLOADING,f.engine().start(asset).phase);assertEquals(1,f.downloads.starts)
        f.downloads.progress=TransferProgress(TransferPhase.PAUSED,6,10)
        assertEquals(UpdatePhase.PAUSED,f.engine().status().phase)
        f.engine().cancel();assertNull(f.store.value);assertEquals(listOf(1L),f.downloads.removed);assertTrue(f.installer.installs.isEmpty())
    }
    @Test fun failedTransferCanRetryWithFreshJob(){
        val f=Fixture(installed);f.engine().start(asset);f.downloads.progress=TransferProgress(TransferPhase.FAILED)
        assertEquals(UpdatePhase.FAILED,f.engine().status().phase);assertEquals(UpdateProblem.TRANSFER,f.store.value!!.failure)
        f.downloads.progress=TransferProgress(TransferPhase.DOWNLOADING)
        assertEquals(UpdatePhase.DOWNLOADING,f.engine().start(asset).phase);assertEquals(2,f.downloads.starts)
    }
    @Test fun saveFailureRemovesSystemJobAndNeverReportsSuccess(){
        val f=Fixture(installed);var writes=0
        val failing=object:UpdateJobStore {override fun read():DownloadRecord?=null;override fun write(record:DownloadRecord?){if(++writes>1)error("disk")}}
        val engine=UpdateEngine(installed,"2.9.0",failing,f.downloads,f.files,f.installer)
        reject(UpdateProblem.STORAGE){engine.start(asset)};assertEquals(listOf(1L),f.downloads.removed);assertTrue(f.installer.installs.isEmpty())
    }
    @Test fun completeRequiresIdentityThenForceRevalidationAndExplicitInstallPermission(){
        val f=Fixture(installed);val engine=f.engine();engine.start(asset);f.downloads.progress=TransferProgress(TransferPhase.COMPLETE,10,10)
        assertEquals(UpdatePhase.READY,engine.status().phase);assertTrue(f.installer.installs.isEmpty())
        reject(UpdateProblem.PERMISSION){engine.install()};engine.authorize();assertEquals(1,f.installer.authorizations)
        f.installer.permit=true;engine.install();assertEquals(listOf("b".repeat(32)),f.installer.installs);assertTrue(f.files.verifies.last())
    }
    @Test fun mutatedFileAtFinalRecheckRemovesReadyStateAndNeverCallsInstaller(){
        val f=Fixture(installed);val engine=f.engine();engine.start(asset);f.downloads.progress=TransferProgress(TransferPhase.COMPLETE,10,10);f.installer.permit=true
        assertEquals(UpdatePhase.READY,engine.status().phase);f.files.failForce=true
        reject(UpdateProblem.INTEGRITY){engine.install()};assertEquals(UpdatePhase.FAILED,engine.status().phase);assertTrue(f.installer.installs.isEmpty())
    }
    @Test fun everyIdentityBoundaryIsIndependentlyRejected(){
        for(candidate in listOf(installed.copy(packageName="com.blockcolc.preview",version="3.0.0",code=105),installed.copy(version="2.9.1",code=105),installed.copy(version="3.0.0"),installed.copy(version="3.0.0",code=105,privateBuild=true),installed.copy(version="3.0.0",code=105,signers=listOf("other")),installed.copy(version="3.0.0",code=105,signers=emptyList()))){
            val f=Fixture(installed);f.files.candidate=candidate;f.engine().start(asset);f.downloads.progress=TransferProgress(TransferPhase.COMPLETE,10,10)
            assertEquals(UpdatePhase.FAILED,f.engine().status().phase);assertTrue(f.installer.installs.isEmpty())
        }
    }
    @Test fun privateAndPreviewRejectStartAuthorizationAndInstallBeforeTransfer(){
        for(identity in listOf(installed.copy(privateBuild=true),installed.copy(packageName="com.blockcolc.preview"),installed.copy(packageName="other"))){
            val f=Fixture(identity);val engine=f.engine()
            reject(UpdateProblem.CHANNEL){engine.start(asset)};reject(UpdateProblem.CHANNEL){engine.authorize()};reject(UpdateProblem.CHANNEL){engine.install()}
            assertEquals(0,f.downloads.starts);assertTrue(f.installer.installs.isEmpty());assertEquals(0,f.installer.authorizations)
        }
    }
    @Test fun staleJobAfterUpgradeIsCleanedWithoutInstaller(){
        val f=Fixture(installed);f.engine().start(asset)
        val next=UpdateEngine(installed.copy(version="3.0.0",code=105),"3.0.0",f.store,f.downloads,f.files,f.installer)
        assertEquals(UpdatePhase.IDLE,next.status().phase);assertNull(f.store.value)
    }
    @Test fun wrongSizeAndOverrunNeverReachFileVerification(){
        for(progress in listOf(TransferProgress(TransferPhase.COMPLETE,11,10),TransferProgress(TransferPhase.COMPLETE,10,12))){
            val f=Fixture(installed);f.engine().start(asset);f.downloads.progress=progress
            assertEquals(UpdateProblem.INTEGRITY,f.engine().status().problem);assertTrue(f.files.verifies.isEmpty())
        }
    }
    @Test fun oldVersionAndUntrustedDownloadDescriptorNeverCreateAJob(){
        val f=Fixture(installed);reject(UpdateProblem.NOT_NEWER){f.engine().start(asset.copy(version="2.9.0",url=asset.url.replace("3.0.0","2.9.0")))}
        for(bad in listOf(asset.copy(url="https://evil.invalid/update.apk"),asset.copy(size=0),asset.copy(size=UpdatePolicy.MAX_BYTES+1),asset.copy(sha256="bad"))){reject(UpdateProblem.DESCRIPTOR){f.engine().start(bad)}}
        assertEquals(0,f.downloads.starts)
    }
    @Test fun installedVersionAlsoPreventsDowngradeWhenCallerBaselineIsStale(){
        val f=Fixture(installed.copy(version="3.1.0"));reject(UpdateProblem.NOT_NEWER){f.engine().start(asset)};assertEquals(0,f.downloads.starts)
    }
}
