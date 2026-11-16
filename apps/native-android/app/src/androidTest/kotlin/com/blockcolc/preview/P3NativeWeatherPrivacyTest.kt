package com.blockcolc.preview

import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.weather.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Actual Android permission checks and private AtomicFile operations. No
 * permission changes, location-provider changes or network requests here. */
class P3NativeWeatherPrivacyTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun main(block:()->Unit)=instrumentation.runOnMainSync(block)
    @Test fun deniedPermissionCannotUseACacheAndCancelledResultsCannotSurviveAClear(){
        val names=listOf("qweather-last-location-v1","qweather-last-location-v1.bak","qweather-last-location-v1.new")
        val files=names.map{File(context.noBackupFilesDir,it)}
        val original=files.map{if(it.exists())it.readBytes()else null}
        var adapter:AndroidWeatherLocation?=null
        var denied=false;var cancelled=false;var cleared=false;var restored=false
        val identity=checkNotNull(AndroidWeatherIdentity.read(context))
        assertEquals("com.blockcolc.preview",identity.packageName)
        try{
            main{adapter=AndroidWeatherLocation(context);assertFalse("Run privacy scope without a location grant",adapter!!.permissionGranted())}
            // Synthetic coordinates only, never a device location in reports.
            context.noBackupFilesDir.mkdirs();files[0].writeText("12.34,56.78",Charsets.UTF_8)
            val result=AtomicReference<WeatherResult<WeatherLocationFix>>()
            val received=CountDownLatch(1)
            main{adapter!!.request{result.set(it);received.countDown()}}
            assertTrue("Denied request did not finish",received.await(5,TimeUnit.SECONDS))
            assertEquals(WeatherResult.Unavailable(WeatherFailure.LOCATION_PERMISSION_DENIED),result.get());denied=true
            val callbacks=AtomicInteger();val finished=CountDownLatch(1)
            files[1].writeText("12.34,56.78");files[2].writeText("12.34,56.78")
            main{
                val cancel=adapter!!.request{callbacks.incrementAndGet()};cancel()
                adapter!!.clearCache{cleared=it;finished.countDown()}
            }
            assertTrue("Cache clear did not finish",finished.await(5,TimeUnit.SECONDS))
            instrumentation.waitForIdleSync();SystemClock.sleep(100)
            assertEquals(0,callbacks.get());cancelled=true
            assertTrue(cleared);assertTrue(files.none{it.exists()})
        }finally{
            try{
                if(adapter!=null){
                    val done=CountDownLatch(1);main{adapter!!.clearCache{done.countDown()}}
                    assertTrue("Cleanup did not drain private IO",done.await(5,TimeUnit.SECONDS));main{adapter!!.close()}
                }
            }finally{
                files.forEachIndexed{index,file->if(original[index]==null)file.delete()else file.writeBytes(original[index]!!)}
                restored=files.map{if(it.exists())it.readBytes()?.toList()else null}==original.map{it?.toList()}
                record(JSONObject().put("permissionDeniedIgnoredCachedCoordinates",denied).put("cancelledCallbackRejected",cancelled)
                    .put("allAtomicCacheFilesCleared",cleared).put("originalPrivateCacheRestored",restored)
                    .put("networkRequests",0).put("packageName",identity.packageName).put("certificateSha1",identity.certificateSha1))
            }
        }
        assertTrue("Private weather cache must be restored",restored)
    }
    private fun record(value:JSONObject){
        val label=checkNotNull(InstrumentationRegistry.getArguments().getString("p3Group"));require(label.matches(Regex("[a-z0-9-]{1,60}")))
        File(context.filesDir,"p3-world-weather-privacy.json").writeText(value.put("schema",1).put("caseLabel",label).toString(),Charsets.UTF_8)
    }
}
