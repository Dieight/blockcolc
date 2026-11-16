package com.blockcolc.preview

import android.os.Process
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.presentation.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** The host stops the actual preview process between these two methods.
 * Preferences use the real app-private file, protected by the host's byte
 * snapshot; domain work uses a new isolated DB and is restored before exit.
 * No Activity, world, audio, weather provider or updater is started. */
class P3PreferencesRestartTest {
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val args get()=InstrumentationRegistry.getArguments()
    private val variant get()=checkNotNull(args.getString("p3PreferenceVariant")).also{require(it in listOf("defaults","light","dark","system"))}
    private val session get()=checkNotNull(args.getString("p3RestartSession")).also{require(it.matches(Regex("[a-f0-9]{32}")))}
    private val receipt get()=File(context.filesDir,"p3-preference-restart-$session-$variant.json")
    private fun expected()=when(variant){
        "defaults"->ClientPreferences()
        "light"->ClientPreferences(focusMinutes=31,habitFocusMinutes=52,habitTargetRounds=22,breakMinutes=0,
            lightingQuality="performance",constructionOutlineVisibility="off",worldColorAdjustment=WorldColor(140,90,115),
            showWorldCoordinates=true,focusGlassTransparency=15,themeMode="light",fontStyle="mixed",returnToFocusReminders=false,
            autoContinueFocus=true,autoCheckUpdates=true,realWeatherEnabled=true,minimalMode=true,
            ambience=Ambience(true,"shore-waves",true,77),language="en",quickNotesEnabled=true)
        "dark"->ClientPreferences(focusMinutes=180,habitFocusMinutes=1,habitTargetRounds=30,breakMinutes=60,
            lightingQuality="balanced",constructionOutlineVisibility="all",worldColorAdjustment=WorldColor(50,120,80),
            showWorldCoordinates=false,focusGlassTransparency=0,themeMode="dark",fontStyle="system",returnToFocusReminders=true,
            autoContinueFocus=false,autoCheckUpdates=false,realWeatherEnabled=false,minimalMode=false,
            ambience=Ambience(false,"forest-birds",false,0),language="zh-CN",quickNotesEnabled=false)
        else->ClientPreferences(focusMinutes=1,habitFocusMinutes=179,habitTargetRounds=10,breakMinutes=1,
            lightingQuality="auto",constructionOutlineVisibility="current",worldColorAdjustment=WorldColor(150,80,120),
            showWorldCoordinates=true,focusGlassTransparency=100,themeMode="system",fontStyle="pixel",returnToFocusReminders=false,
            autoContinueFocus=true,autoCheckUpdates=false,realWeatherEnabled=false,minimalMode=true,
            ambience=Ambience(false,"shore-waves",true,100),language="en",quickNotesEnabled=true)
    }
    private fun hash(text:String)=MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt()and 255)}
    private fun await(condition:()->Boolean){
        val deadline=SystemClock.elapsedRealtime()+30000
        while(!condition()&&SystemClock.elapsedRealtime()<deadline)SystemClock.sleep(25)
        assertTrue("Preference startup did not finish",condition())
    }
    @Test fun saveThroughTheActualPreferenceWriterBeforeProcessDeath(){
        check(BuildConfig.NATIVE_DIAGNOSTICS);assertFalse(receipt.exists())
        val runtime=PreviewRuntime.get(context)
        val database=runtime.testDatabase(true,prepareAssets=false).get(30,TimeUnit.SECONDS)
        val beforeDocument=runtime.testRead().get(30,TimeUnit.SECONDS).domain
        val before=beforeDocument.sha256
        val value=expected()
        val primed=value.copy(focusMinutes=if(value.focusMinutes==1)2 else 1)
        instrumentation.runOnMainSync{runtime.updatePreferences{primed}}
        await{runtime.latest.preferences==primed&&!runtime.latest.preferencesSaving}
        instrumentation.runOnMainSync{runtime.updatePreferences{value}}
        await{runtime.latest.preferences==value&&!runtime.latest.preferencesSaving}
        assertFalse(runtime.latest.preferencesReadFailed)
        assertEquals(value.canonical(),AndroidPreferencesStorage(context).read())
        val after=runtime.testRead().get(30,TimeUnit.SECONDS).domain
        if(before!=after.sha256){val a=beforeDocument.projectionJson();val b=after.projectionJson()
            val changed=a.keys().asSequence().filter{com.blockcolc.domain.StrictJson.render(a.get(it))!=com.blockcolc.domain.StrictJson.render(b.get(it))}.toList()
            fail("Local preferences changed domain sections: "+changed.joinToString(","))}
        receipt.writeText(JSONObject().put("schema",1).put("variant",variant).put("session",session)
            .put("database",database).put("savedPid",Process.myPid()).put("preferencesSha256",hash(value.canonical()))
            .put("rootFields",JSONObject(value.canonical()).length()).put("saved",true).toString())
        // The host will force-stop this process. Restoration deliberately
        // belongs to the second process and the host's outer finally block.
    }
    @Test fun actualRuntimeReloadsEverySavedFieldInANewProcessAndRestoresItsDatabase(){
        check(BuildConfig.NATIVE_DIAGNOSTICS)
        val record=JSONObject(receipt.readText());assertEquals(session,record.getString("session"));assertEquals(variant,record.getString("variant"))
        assertNotEquals("The host did not restart the app process",record.getInt("savedPid"),Process.myPid())
        val selected=context.getSharedPreferences("p2-storage",0)
        val database=record.getString("database");require(database.matches(Regex("p2-device-[a-f0-9-]{36}\\.db")))
        assertEquals(database,selected.getString("database",null));assertNotNull(selected.getString("beforeTest",null))
        val runtime=PreviewRuntime.get(context);runtime.start()
        await{runtime.latest.ready||runtime.latest.error!=null}
        assertNull(runtime.latest.error);assertFalse(runtime.latest.preferencesReadFailed);assertFalse(runtime.latest.preferencesSaving)
        val value=expected();assertEquals(value,runtime.latest.preferences)
        assertEquals(record.getString("preferencesSha256"),hash(runtime.latest.preferences.canonical()))
        assertEquals(value.canonical(),AndroidPreferencesStorage(context).read())
        val restored=runtime.testDatabase(false,prepareAssets=false).get(30,TimeUnit.SECONDS)
        assertNotEquals(database,restored);assertNull(selected.getString("beforeTest",null))
        assertEquals(restored,selected.getString("database",null))
        assertTrue(context.deleteDatabase(database))
        val presentation=File(context.filesDir,"presentation-$database")
        if(presentation.exists()){assertEquals(context.filesDir,presentation.parentFile);assertTrue(presentation.deleteRecursively())}
        if(android.os.Build.VERSION.SDK_INT>=24)context.deleteSharedPreferences("native-ui-$database")
        record.put("readPid",Process.myPid()).put("reloaded",true).put("restoredDatabase",restored).put("ownedDatabaseRemoved",true)
        receipt.writeText(record.toString())
    }
}
