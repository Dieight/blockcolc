package com.blockcolc.preview

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.blockcolc.domain.*
import com.blockcolc.preview.environment.NativeRealWeatherController
import com.blockcolc.storage.BackupCodec
import com.blockcolc.weather.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.util.regex.Pattern

/** Explicit live scope only; never included in the general native page suite. */
class P3NativeWeatherSettingsLiveTest {
    @get:Rule val compose=createComposeRule()
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context=instrumentation.targetContext
    private val runtime get()=PreviewRuntime.get(context)
    @Test fun theRealNativeSettingsShowsServiceFactsAttributionsAndClearsOnDisable(){
        val label=checkNotNull(InstrumentationRegistry.getArguments().getString("p3Group"));require(label.matches(Regex("[a-z0-9-]{1,60}")))
        val device=UiDevice.getInstance(instrumentation)
        val controller=AtomicReference<NativeRealWeatherController>()
        instrumentation.runOnMainSync{controller.set(NativeRealWeatherController.get(context))}
        fun state():RealWeatherView{val value=AtomicReference<RealWeatherView>();instrumentation.runOnMainSync{value.set(controller.get().snapshot())};return value.get()}
        assertTrue(WeatherCredentials.fromLocalBuild().configured);assertFalse(controller.get().permissionGranted())
        runtime.testDatabase(true).get(30,TimeUnit.SECONDS)
        var preferences=false;var mounted=false;var show by mutableStateOf(true);var cleaned=false;var success:RealWeatherView?=null
        try{
            runtime.testClientPreferences(true).get(30,TimeUnit.SECONDS);preferences=true
            val now=System.currentTimeMillis();val initial=DomainEngine.initial("UTC")
            val created=DomainEngine.execute(initial,DomainEngine.command("CreateHabitProject","projectId" to "weather-settings","title" to "Weather settings test",
                "blueprintId" to "builtin-timber-house","targetRounds" to 10),now);check(created.ok)
            runtime.testOperation{it.importBackup("weather-settings-live",BackupCodec.read(BackupCodec.write(created.state,DomainTime.format(now))),now)}.get(30,TimeUnit.SECONDS)
            runtime.updatePreferences{it.copy(themeMode="dark",realWeatherEnabled=false)}
            compose.waitUntil(10000){!runtime.latest.preferencesSaving&&runtime.latest.preferences.themeMode=="dark"}
            compose.setContent{if(show)NativeApp(runtime)};mounted=true
            compose.waitUntil(60000){compose.onAllNodesWithTag("workspace-ready").fetchSemanticsNodes().isNotEmpty()}
            compose.onNodeWithContentDescription("设置").performClick()
            compose.onNodeWithText("同步现实天气").performScrollTo().performClick()
            // The actor saves asynchronously. Pump Compose through that
            // acknowledgement before switching to the system UI clock.
            compose.waitUntil(10000){runtime.latest.preferences.realWeatherEnabled&&!runtime.latest.preferencesSaving}
            compose.waitForIdle()
            val once=device.wait(Until.findObject(By.res(Pattern.compile(".*:id/permission_allow_one_time_button"))),15000)
            assertNotNull("Actual native settings did not request one-time location permission",once);once.click()
            compose.waitUntil(10000){controller.get().permissionGranted()}
            compose.waitUntil(50000){val value=state();value.enabled&&value.weather!=WeatherSync.SYNCING&&value.astronomy!=AstronomySync.SYNCING&&
                value.weatherFailure!=WeatherFailure.LOCATION_PERMISSION_DENIED&&
                (value.weather==WeatherSync.AVAILABLE||value.weather==WeatherSync.FALLBACK)}
            val value=state();success=value
            assertEquals(WeatherSync.AVAILABLE,value.weather);assertEquals(AstronomySync.CALENDAR,value.astronomy)
            val current=checkNotNull(value.current)
            compose.onNodeWithText("天气：${current.conditionText}",substring=true).performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("日月：已同步",substring=true).performScrollTo().assertIsDisplayed()
            compose.onNodeWithContentDescription("天气与天文数据来源说明").performScrollTo().performClick()
            compose.onNodeWithText("和风天气").assertIsDisplayed()
            assertTrue((current.attributions+value.calendar!!.attributions).distinct().isNotEmpty())
            compose.waitForIdle();device.waitForIdle(1000);android.os.SystemClock.sleep(150)
            check(device.takeScreenshot(File(context.filesDir,"p3-pages-$label-weather-service-success-${UUID.randomUUID()}.png")))
            device.pressBack()
            compose.onNodeWithText("同步现实天气").performScrollTo().performClick()
            compose.waitUntil(10000){!runtime.latest.preferencesSaving&&!runtime.latest.preferences.realWeatherEnabled&&!state().clearing}
            compose.onNodeWithContentDescription("天气与天文数据来源说明").assertDoesNotExist()
            assertNull(state().current);assertNull(state().calendar);assertNull(state().location);assertFalse(state().clearFailed)
            assertTrue(listOf("qweather-last-location-v1","qweather-last-location-v1.bak","qweather-last-location-v1.new").none{File(context.noBackupFilesDir,it).exists()})
            cleaned=true
        }catch(error:Throwable){
            runCatching{device.takeScreenshot(File(context.filesDir,"p3-pages-$label-weather-service-failure-${UUID.randomUUID()}.png"))}
            throw error
        }finally{
            try{
                if(preferences){runtime.updatePreferences{it.copy(realWeatherEnabled=false)}
                    compose.waitUntil(10000){!runtime.latest.preferencesSaving&&!state().clearing}}
                if(mounted){instrumentation.runOnMainSync{show=false};compose.waitForIdle()}
            }finally{
                try{if(preferences)runtime.testClientPreferences(false).get(30,TimeUnit.SECONDS)}finally{runtime.testDatabase(false).get(30,TimeUnit.SECONDS)}
                File(context.filesDir,"p3-world-weather-settings-live.json").writeText(JSONObject().put("schema",1).put("caseLabel",label)
                    .put("serviceAvailable",success?.current!=null).put("astronomyAvailable",success?.calendar!=null)
                    .put("attributionCount",(success?.current?.attributions.orEmpty()+success?.calendar?.attributions.orEmpty()).distinct().size)
                    .put("disabledClearedFactsAndCache",cleaned).put("coordinatesOrCredentialsRecorded",false).toString())
            }
        }
    }
}
