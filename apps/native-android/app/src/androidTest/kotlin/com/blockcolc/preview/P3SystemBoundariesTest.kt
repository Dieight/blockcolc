package com.blockcolc.preview

import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.*
import com.blockcolc.focus.DailyBackupCoordinator
import com.blockcolc.preview.updates.NativeLegalCatalog
import com.blockcolc.storage.*
import com.blockcolc.storage.android.AndroidStateDatabase
import com.blockcolc.updates.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/** Uses private test DB/files only. Does not enqueue public downloads, request
 * install permission, launch an installer, or modify the preview's real state. */
@RunWith(AndroidJUnit4::class)
class P3SystemBoundariesTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun androidDailyTransactionsRetryAndRetainIndependentRollback(){
        val name="p3-system-${UUID.randomUUID()}.db"
        try{AndroidStateDatabase(context,name).use{db->
            val store=NativeStateStore(db);val initial=store.initialize(DomainEngine.initial("UTC"))
            val at="2026-10-27T23:59:59.000Z"
            val imported=store.importBackup(initial.token,"import",BackupCodec.read(BackupCodec.write(initial.domain,at)),at)
            var now=DomainTime.millis(at);var elapsed=0L;var fail=true;val failures=mutableListOf<Boolean>()
            val capture=NativeStateStore(db){if(fail&&it=="after-daily-root")error("injected-save-failure")}
            fun scheduler()=DailyBackupCoordinator({now},{elapsed},{date,time->
                val result=capture.captureDaily(store.load()!!.token,DomainTime.format(time),targetDate=date)
                check(!result.overBudget)
            },{failures+=it}).apply{context("db:${imported.token.replacementGeneration}","UTC");foreground(true)}
            val daily=scheduler();daily.check();assertEquals(listOf(true),failures);assertEquals(listOf(imported.rollbackId),store.backupRoots().map{it.id})
            fail=false;elapsed=60_000;daily.check();assertEquals(listOf(true,false),failures)
            assertEquals("2026-10-26",store.backupRoots().single{it.kind=="daily"}.date)
            daily.foreground(false);now+=1000;assertNull(daily.check());daily.foreground(true);daily.check()
            assertEquals("2026-10-27",store.backupRoots().single{it.kind=="daily"}.date)
            val roots=store.backupRoots();scheduler().check();assertEquals(roots,store.backupRoots())
            assertEquals(imported.token,store.load()!!.token);assertTrue(store.backupRoots().any{it.id==imported.rollbackId})
        }}finally{context.deleteDatabase(name)}
    }
    @Test fun atomicDownloadRecordReopensAndRejectsCorruptIndex(){
        val directory=File(context.cacheDir,"p3-update-${UUID.randomUUID()}").apply{check(mkdir())}
        try{
            val file=File(directory,"job.json");val asset=UpdateAsset("3.0.0","${UpdatePolicy.REPOSITORY}/releases/download/v3.0.0/Blockcolc-v3.0.0.apk",10,"a".repeat(64))
            val record=DownloadRecord(42,"b".repeat(32),asset)
            AndroidUpdateJobStore(file).write(record);assertEquals(record,AndroidUpdateJobStore(file).read())
            AndroidUpdateJobStore(file).write(null);assertNull(AndroidUpdateJobStore(file).read())
            file.writeText("{");assertEquals(UpdateProblem.STORAGE,(runCatching{AndroidUpdateJobStore(file).read()}.exceptionOrNull() as UpdateFailure).problem)
        }finally{check(directory.parentFile==context.cacheDir);check(directory.deleteRecursively())}
    }
    @Test fun previewIdentityAndProviderRejectCrossAppInstallBoundary(){
        val identity=AndroidApkIdentity.installed(context)
        assertEquals("com.blockcolc.preview",identity.packageName);assertTrue(identity.signers.isNotEmpty())
        assertEquals(UpdateChannel.PREVIEW,UpdatePolicy.channel(identity.copy(privateBuild=false)))
        assertEquals(UpdateProblem.CHANNEL,(runCatching{UpdatePolicy.requireDownload(identity)}.exceptionOrNull() as UpdateFailure).problem)
        val token=UUID.randomUUID().toString().replace("-","")
        val file=File(context.getExternalFilesDir("updates"),"$token.apk")
        val outside=File(context.filesDir,"p3-outside-$token.txt")
        try{
            file.writeText("provider-boundary");outside.writeText("not shared")
            val uri=FileProvider.getUriForFile(context,"${context.packageName}.updates",file)
            assertEquals("provider-boundary",context.contentResolver.openInputStream(uri)!!.bufferedReader().use{it.readText()})
            assertTrue(runCatching{FileProvider.getUriForFile(context,"${context.packageName}.updates",outside)}.isFailure)
        }finally{check(file.delete());check(outside.delete())}
    }
    @Test fun everyAboutLicenseIsPackagedWithFullReadableText(){
        val all=listOf(NativeLegalCatalog.project)+NativeLegalCatalog.entries
        assertEquals(all.size,all.map{it.asset}.toSet().size)
        all.forEach{entry->
            val bytes=context.assets.open(entry.asset).use{it.readBytes()}
            assertTrue(entry.asset,bytes.size in 128..256*1024)
            assertTrue(entry.upstream.startsWith("https://"))
        }
        assertTrue(context.assets.open("about-licenses/suncalc.txt").bufferedReader().use{it.readText()}.contains("Redistribution"))
    }
}
