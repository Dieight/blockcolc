package com.blockcolc.preview

import android.os.SystemClock
import android.Manifest
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.blockcolc.preview.environment.NativeRealWeatherController
import com.blockcolc.weather.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.concurrent.atomic.AtomicReference
import java.util.regex.Pattern

/** Explicit live scope only. Uses this APK's identity and actual Android
 * location; outcomes distinguish service acceptance from a bounded fallback. */
class P3NativeWeatherLiveTest {
    @get:Rule val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private fun main(block:()->Unit)=instrumentation.runOnMainSync(block)
    private fun await(limit:Long=50_000,condition:()->Boolean){
        val deadline=SystemClock.elapsedRealtime()+limit
        while(!condition()){assertTrue("Live weather did not settle within its bound",SystemClock.elapsedRealtime()<deadline);SystemClock.sleep(100)}
    }
    @Test fun actualLocationAndCurrentApkIdentityReachAnExplicitServiceOrFallbackOutcome(){
        var controller:NativeRealWeatherController?=null;val owner=Any();var acquired=false
        fun state():RealWeatherView{val result=AtomicReference<RealWeatherView>();main{result.set(controller!!.snapshot())};return result.get()}
        val identity=checkNotNull(AndroidWeatherIdentity.read(context));assertEquals("com.blockcolc.preview",identity.packageName)
        val started=SystemClock.elapsedRealtime();var settled:RealWeatherView?=null;var cleaned=false
        try{
            assertTrue("Live scope needs the authorized local Android build configuration",WeatherCredentials.fromLocalBuild().configured)
            main{controller=NativeRealWeatherController.get(context)}
            assertFalse("The known restore package has no location permission",controller!!.permissionGranted())
            foreground.scenario.onActivity{it.requestPermissions(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION,Manifest.permission.ACCESS_FINE_LOCATION),4089)}
            // Follow the actual runtime permission dialog. This device denies
            // shell grants; do not change USB security or global policies.
            val device=UiDevice.getInstance(instrumentation)
            val once=device.wait(Until.findObject(By.res(Pattern.compile(".*:id/permission_allow_one_time_button"))),15_000)
            assertNotNull("The location dialog did not offer a one-time grant",once);once.click()
            await(5000){controller!!.permissionGranted()}
            main{
                controller!!.acquire(owner);acquired=true;controller!!.configure(true,"zh-CN");controller!!.foreground(owner,true)}
            await{val s=state();s.enabled&&s.weather!=WeatherSync.SYNCING&&s.astronomy!=AstronomySync.SYNCING&&
                (s.weather==WeatherSync.AVAILABLE||s.weather==WeatherSync.FALLBACK)}
            settled=state();val result=settled!!
            val current=result.current
            if(current!=null){assertNotNull(result.location);assertEquals(WeatherSync.AVAILABLE,result.weather)
                assertNotNull(WeatherAppearance.from(current));assertTrue(current.attributions.isNotEmpty())}
            else{assertEquals(WeatherSync.FALLBACK,result.weather);assertNotNull(result.weatherFailure)}
            if(result.calendar!=null){assertNotNull(result.location);assertEquals(AstronomySync.CALENDAR,result.astronomy)}
            // Repeated owner/configuration updates must preserve published
            // observations; they are not a manual refresh or route event.
            repeat(8){main{controller!!.configure(true,"zh-CN");controller!!.foreground(owner,true)}}
            assertSame(result.current,state().current);assertSame(result.calendar,state().calendar)
        }finally{
            if(controller!=null&&acquired){
                main{controller!!.configure(false,"zh-CN")}
                await(5000){!state().clearing}
                val disabled=state();assertFalse(disabled.clearFailed);assertNull(disabled.location);assertNull(disabled.current);assertNull(disabled.calendar)
                assertTrue(listOf("qweather-last-location-v1","qweather-last-location-v1.bak","qweather-last-location-v1.new").none{File(context.noBackupFilesDir,it).exists()})
                main{controller!!.release(owner)};cleaned=true
            }
            val label=checkNotNull(InstrumentationRegistry.getArguments().getString("p3Group"));require(label.matches(Regex("[a-z0-9-]{1,60}")))
            File(context.filesDir,"p3-world-weather-live.json").writeText(JSONObject().put("schema",1).put("caseLabel",label)
                .put("packageName",identity.packageName).put("certificateSha1",identity.certificateSha1)
                .put("permissionDecision","one_time_via_runtime_dialog")
                .put("elapsedMs",SystemClock.elapsedRealtime()-started).put("locationAvailable",settled?.location!=null)
                .put("locationSource",settled?.location?.source?.wire?:JSONObject.NULL)
                .put("serviceAvailable",settled?.current!=null).put("weatherState",settled?.weather?.name?:JSONObject.NULL)
                .put("weatherFailure",settled?.weatherFailure?.wire?:JSONObject.NULL)
                .put("astronomyAvailable",settled?.calendar!=null).put("astronomyState",settled?.astronomy?.name?:JSONObject.NULL)
                .put("astronomyFailure",settled?.astronomyFailure?.wire?:JSONObject.NULL)
                .put("coordinatesOrCredentialsRecorded",false).put("disabledClearedFactsAndCache",cleaned)
                .put("boundedOutcomeOnly",true).toString(),Charsets.UTF_8)
        }
    }
}
