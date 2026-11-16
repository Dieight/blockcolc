package com.blockcolc.preview

import android.app.Notification
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.audio.*
import com.blockcolc.domain.DomainEngine
import com.blockcolc.preview.environment.NativeEnvironmentSession
import com.blockcolc.world.NativeAtmosphereFacts
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import java.io.File
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Real Android resolver, MediaPlayer, audio focus and media notification.
 * Volume is zero throughout; no global sound or battery setting is changed. */
class P3NativeAudioTest {
    @get:Rule val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    @get:Rule val testName=TestName()
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val controller get()=NativeAudioController.get(context)
    private val label get()=checkNotNull(InstrumentationRegistry.getArguments().getString("p3Group"))
    private var protectedOriginals:Set<String> = emptySet()
    private fun main(action:()->Unit)=instrumentation.runOnMainSync(action)
    private fun inspect():JSONObject{val result=AtomicReference<JSONObject>();main{result.set(AmbientAudioHost.inspect())};return result.get()}
    private fun await(timeout:Long=20000,condition:()->Boolean){val until=SystemClock.elapsedRealtime()+timeout
        var accepted=condition()
        while(!accepted&&SystemClock.elapsedRealtime()<until){SystemClock.sleep(100);accepted=condition()}
        if(!accepted)fail("Native audio did not reach its expected state: ${inspect()}")}
    private fun playing(source:String):Boolean {val state=inspect();return state.optString("primary")==source&&state.optBoolean("mainPlaying")&&state.getJSONObject("projection").optBoolean("mainReady")}
    private fun record(name:String,value:JSONObject){File(context.filesDir,"p3-world-audio-$name.json").writeText(value.put("caseLabel",label).toString())}
    private fun isolated(action:()->Unit){
        assertEquals("com.blockcolc.preview",context.packageName);assertFalse(AmbientAudioHost.snapshot().active)
        val prefs=context.getSharedPreferences("blockcolc_ambient_playback",0);val old=prefs.all.toMap()
        val indexNames=listOf("ambient-library.json","ambient-library.json.bak","ambient-library.json.new")
        val index=indexNames.associateWith{File(context.filesDir,it).takeIf(File::isFile)?.readBytes()}
        val folder=File(context.filesDir,"ambient-imports");val folderExisted=folder.exists();val before=folder.list()?.toSet().orEmpty()
        protectedOriginals=before
        try{main{prefs.edit().clear().commit();controller.foreground(true)};action()}
        finally{
            main{controller.configure(AudioSelection(volume=0));controller.foreground(false);context.stopService(Intent(context,AmbientAudioService::class.java))}
            await{!AmbientAudioHost.snapshot().active&&!controller.snapshot().busy}
            for((name,bytes)in index){val file=File(context.filesDir,name);if(bytes==null)file.delete()else file.writeBytes(bytes)}
            folder.listFiles()?.filter{it.name !in before}?.forEach{assertTrue(it.isFile);assertTrue(it.delete())};if(!folderExisted)folder.delete()
            main{val edit=prefs.edit().clear();for((key,value)in old){when(value){is Boolean->edit.putBoolean(key,value);is String->edit.putString(key,value);is Int->edit.putInt(key,value);is Long->edit.putLong(key,value);is Float->edit.putFloat(key,value);is Set<*>->{assertTrue(value.all{it is String});edit.putStringSet(key,value.filterIsInstance<String>().toSet())};else->error("Unknown existing playback preference")}};assertTrue(edit.commit())}
            for((name,bytes)in index){val file=File(context.filesDir,name);if(bytes==null)assertFalse(file.exists())else assertArrayEquals(bytes,file.readBytes())}
            val state=File(context.filesDir,"p3-world-audio-restored.json")
            val prior=state.takeIf(File::isFile)?.readText()?.let(::JSONObject)?.takeIf{it.optString("caseLabel")==label}
            val records=prior?.getJSONArray("cases")?:JSONArray()
            val indexRestored=index.all{(name,bytes)->val file=File(context.filesDir,name);if(bytes==null)!file.exists()else file.isFile&&bytes.contentEquals(file.readBytes())}
            val preferencesRestored=old==prefs.all;val entriesRestored=before==folder.list()?.toSet().orEmpty()
            records.put(JSONObject().put("test",testName.methodName).put("indexRestored",indexRestored).put("preferencesRestored",preferencesRestored)
                .put("importedEntriesRestored",entriesRestored).put("serviceStopped",!AmbientAudioHost.snapshot().active))
            record("restored",JSONObject().put("schema",1).put("cases",records));assertTrue(indexRestored&&preferencesRestored&&entriesRestored)
        }
    }
    private fun imported(path:String):ImportedAudio {
        val done=CountDownLatch(1);val saved=AtomicReference<ImportedAudio>()
        main{controller.importAudio(Uri.parse("content://com.blockcolc.preview.p3-audio/$path")){saved.set(it);done.countDown()}}
        assertTrue("Resolver import did not finish: ${controller.snapshot().error}",done.await(25,TimeUnit.SECONDS));return saved.get()
    }
    private fun notification()=(context.getSystemService(NotificationManager::class.java).activeNotifications.singleOrNull{it.id==43010}
        ?:throw AssertionError("Own media notification was not published")).notification
    @Test fun builtinsDecodeFullyAndOwnMediaActionsPauseResumeAndStopThePlayer()=isolated{
        val source=context.assets.open("native-audio-source.json").use{JSONObject(it.bufferedReader().readText())}
        assertEquals(16,source.getJSONArray("sources").length());val data=JSONArray()
        for(name in listOf("forest-birds","shore-waves")){
            main{controller.configure(AudioSelection(true,name,false,0,"en"))}
            await{playing(name)}
            val ready=inspect();assertTrue(ready.getLong("durationMs")>30000);assertEquals(0.0,ready.getDouble("gain"),0.0)
            val n=notification();assertNotNull(n.extras.getParcelable<android.media.session.MediaSession.Token>(Notification.EXTRA_MEDIA_SESSION));assertEquals(2,n.actions.size)
            assertEquals("Ambient audio",n.extras.getString(Notification.EXTRA_TITLE))
            n.actions[0].actionIntent.send();await{AmbientAudioHost.snapshot().paused&&!inspect().optBoolean("mainPlaying")&&notification().actions[0].title.toString()=="Play"}
            val paused=inspect();SystemClock.sleep(300);assertEquals(paused.getLong("positionMs"),inspect().getLong("positionMs"))
            notification().actions[0].actionIntent.send();await{inspect().optBoolean("mainPlaying")};SystemClock.sleep(200)
            assertTrue(inspect().getLong("positionMs")>=paused.getLong("positionMs"))
            data.put(JSONObject().put("source",name).put("ready",ready).put("paused",paused).put("resumed",inspect()))
        }
        notification().actions[1].actionIntent.send();await{!AmbientAudioHost.snapshot().active&&context.getSystemService(NotificationManager::class.java).activeNotifications.none{it.id==43010}}
        main{controller.play()};await{playing("shore-waves")}
        // Empty selection must release the service, not leave a silent FGS.
        main{controller.configure(AudioSelection(volume=0))};await{!AmbientAudioHost.snapshot().active}
        record("media",JSONObject().put("schema",1).put("sources",data).put("notificationStopRemovedService",true).put("emptySelectionStoppedService",true))
    }
    @Test fun resolverImportsAndFailedPreferenceReceiptsPreserveTheImportedOriginal()=isolated{
        val item=imported("bird");assertEquals(1476536L,item.bytes);assertTrue(item.durationMs>30000)
        assertFalse("An existing imported original must not be removed by this fixture",item.id in protectedOriginals)
        main{controller.configure(AudioSelection(true,item.id,false,0))};await{playing(item.id)}
        val played=inspect();main{controller.configure(AudioSelection(volume=0))};await{!AmbientAudioHost.snapshot().active}
        main{controller.remove(item.id){FutureTask<Unit>{throw IOException("Injected unsaved preference")}.apply{run()}}};await{!controller.snapshot().busy}
        assertNotNull(controller.snapshot().error);assertTrue(controller.snapshot().items.any{it.id==item.id})
        assertTrue(File(context.filesDir,"ambient-imports/${item.id}").isFile)
        main{controller.remove(item.id){FutureTask<Unit>{Unit}.apply{run()}}};await{!controller.snapshot().busy}
        assertNull(controller.snapshot().error);assertFalse(controller.snapshot().items.any{it.id==item.id});assertFalse(File(context.filesDir,"ambient-imports/${item.id}").exists())
        record("import",JSONObject().put("schema",1).put("bytes",item.bytes).put("durationMs",item.durationMs).put("played",played).put("failedReceiptKeptOriginal",true).put("removedAfterSavedReceipt",true))
    }
    @Test fun rainLayersCrossfadeFromExistingWeatherWithoutSeekingTheMainRecording()=isolated{
        main{controller.weather(true,.05);controller.configure(AudioSelection(true,"forest-birds",true,0))}
        await{AmbientAudioHost.snapshot().mainReady&&AmbientAudioHost.snapshot().rainReady==2};SystemClock.sleep(1000)
        val light=inspect();assertTrue(light.getDouble("lightRainGain")>light.getDouble("heavyRainGain"))
        main{controller.weather(true,.95)}
        await{inspect().optDouble("heavyRainGain")>inspect().optDouble("lightRainGain")};val heavy=inspect()
        assertTrue(heavy.getLong("positionMs")>=light.getLong("positionMs"))
        main{controller.weather(false,0.0)};await(30000){inspect().optInt("rainPlayers")==0};val clear=inspect()
        assertTrue(clear.getBoolean("mainPlaying"));assertTrue(clear.getLong("positionMs")>=heavy.getLong("positionMs"))
        record("rain",JSONObject().put("schema",1).put("light",light).put("heavy",heavy).put("clear",clear)
            .put("weatherInput","Injected through the existing weather port; this case does not exercise a weather provider"))
    }
    @Test fun realCompletionWaitsForARandomGapBeforeTheSameRecordingRestarts()=isolated{
        val item=imported("short");assertTrue(item.durationMs in 1900..2100)
        main{controller.configure(AudioSelection(true,item.id,false,0))};await{inspect().optBoolean("mainPlaying")}
        await{!inspect().optBoolean("mainPlaying")&&inspect().optLong("positionMs")>=1800}
        val completed=SystemClock.elapsedRealtime();SystemClock.sleep(1000);assertFalse(inspect().getBoolean("mainPlaying"))
        await(33000){inspect().optBoolean("mainPlaying")&&inspect().optLong("positionMs")<1800}
        val gap=SystemClock.elapsedRealtime()-completed;assertTrue("Random rest was $gap ms",gap in 11500..33000)
        record("gap",JSONObject().put("schema",1).put("durationMs",item.durationMs).put("gapMs",gap).put("restarted",inspect()))
    }
    private fun digest(file:File):String=java.security.MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString(""){"%02x".format(it.toInt()and 255)}
    private fun decodedAdvance(source:String):JSONObject {
        val before=inspect();val position=before.getLong("positionMs")
        // isPlaying can precede the audio sink consuming its first buffer.
        // Require actual progress while playing, not a fixed scheduler delay.
        await(5000){val state=inspect();state.optString("primary")==source&&state.optBoolean("mainPlaying")&&state.optLong("positionMs")>position}
        return JSONObject().put("before",before).put("after",inspect())
    }
    private fun formatFixtures(action:(String,Map<String,File>)->Unit){
        val session=java.util.UUID.randomUUID().toString().replace("-","")
        val folder=File(context.cacheDir,"p3-audio-formats-$session");check(folder.mkdir())
        try{
            val assets=instrumentation.context.assets
            val entries=assets.open("p3-audio-formats/manifest.json").bufferedReader().use{JSONObject(it.readText())}.getJSONArray("entries")
            val files=linkedMapOf<String,File>()
            for(i in 0 until entries.length()){
                val item=entries.getJSONObject(i);val id=item.getString("id")
                require(id in setOf("pcm","mp3","aac","flac","vorbis","opus"))
                val file=File(folder,id);assets.open("p3-audio-formats/${item.getString("file")}").use{input->file.outputStream().use{input.copyTo(it)}}
                assertEquals(item.getLong("bytes"),file.length());assertEquals(item.getString("sha256"),digest(file));files[id]=file
            }
            assertEquals(6,files.size)
            action(session,files)
        }finally{assertEquals(context.cacheDir,folder.parentFile);assertTrue(folder.deleteRecursively())}
    }
    @Test fun sixRealAudioContainersImportWithoutExtensionsDecodeAndReopenByTheirContent()=isolated{formatFixtures{session,fixtures->
        assertTrue("The isolated fixture needs six free import slots",protectedOriginals.size+fixtures.size<=AudioLibrary.MAX_FILES)
        val results=JSONArray();val savedItems=mutableListOf<ImportedAudio>()
        for((format,file)in fixtures){
            val item=imported("format/$session/$format");savedItems+=item
            assertEquals(digest(file),item.id);assertEquals(file.length(),item.bytes);assertTrue("$format duration ${item.durationMs}",item.durationMs in 3900..4300)
            assertTrue(item.name.endsWith(".bin"))
            main{controller.configure(AudioSelection(true,item.id,false,0))};await{playing(item.id)}
            val decoded=decodedAdvance(item.id)
            main{controller.configure(AudioSelection(volume=0))};await{!AmbientAudioHost.snapshot().active}
            results.put(JSONObject().put("format",format).put("sha256",item.id).put("bytes",item.bytes).put("durationMs",item.durationMs).put("decoded",decoded))
        }
        val disk=AudioLibrary(File(context.filesDir,"ambient-imports"),object:AudioIndex{
            override fun read()=android.util.AtomicFile(File(context.filesDir,"ambient-library.json")).openRead().bufferedReader().use{it.readText()}
            override fun write(value:String)=error("Reopen check is read-only")
        },{error("Stored metadata must not need decoding to reopen")})
        for(item in savedItems){assertTrue(item in disk.list());assertEquals(item.id,digest(disk.playable(item.id)))}
        record("formats",JSONObject().put("schema",1).put("formats",results).put("reopened",true)
            .put("scope","Six short test-only files, Android resolver/metadata/decoder and persisted originals; not every codec profile or whole-recording listening acceptance"))
    }}
    @Test fun streamOnlyProviderIsCopiedBeforePlaybackAndNeedsNoLaterProviderAccess()=isolated{formatFixtures{session,fixtures->
        val item=imported("pipe/$session/aac");assertEquals(digest(fixtures.getValue("aac")),item.id)
        assertTrue(fixtures.getValue("aac").delete())
        main{controller.configure(AudioSelection(true,item.id,false,0))};await{playing(item.id)}
        val decoded=decodedAdvance(item.id)
        record("pipe",JSONObject().put("schema",1).put("sha256",item.id).put("bytes",item.bytes).put("providerOriginalRemoved",true).put("playedFromOwnedCopy",true).put("decoded",decoded))
    }}
    @Test fun deniedMissingEmptyInvalidAndInterruptedProvidersKeepTheExistingLibraryAndPlayback()=isolated{formatFixtures{session,fixtures->
        val kept=imported("format/$session/pcm")
        val folder=fixtures.getValue("pcm").parentFile!!;File(folder,"empty").writeBytes(byteArrayOf());File(folder,"invalid").writeText("This is not an audio container")
        val index=File(context.filesDir,"ambient-library.json");val beforeIndex=index.readBytes()
        val beforeItems=controller.snapshot().items;val beforeFiles=File(context.filesDir,"ambient-imports").list()!!.toSet()
        main{controller.configure(AudioSelection(true,"forest-birds",false,0))};await{playing("forest-birds")}
        val failures=JSONArray()
        for(path in listOf("denied/$session/pcm","missing/$session/pcm","format/$session/empty","format/$session/invalid","broken/$session/flac")){
            val callback=java.util.concurrent.atomic.AtomicBoolean(false)
            main{controller.importAudio(Uri.parse("content://com.blockcolc.preview.p3-audio/$path")){callback.set(true)}}
            await{!controller.snapshot().busy}
            assertNotNull("Failed provider must report an error: $path",controller.snapshot().error);assertFalse(callback.get())
            assertEquals(beforeItems,controller.snapshot().items);assertArrayEquals(beforeIndex,index.readBytes())
            assertEquals(beforeFiles,File(context.filesDir,"ambient-imports").list()!!.toSet());assertEquals(kept.id,digest(File(context.filesDir,"ambient-imports/${kept.id}")))
            assertTrue(playing("forest-birds"));failures.put(JSONObject().put("provider",path.substringBefore('/')).put("error",controller.snapshot().error))
        }
        val retried=imported("pipe/$session/aac");assertTrue(controller.snapshot().items.any{it.id==retried.id});assertNull(controller.snapshot().error)
        record("provider-failures",JSONObject().put("schema",1).put("failures",failures).put("retrySaved",true).put("existingOriginalKept",true).put("playbackKept",true))
    }}
    @Test @androidx.test.filters.SdkSuppress(minSdkVersion=26) @android.annotation.TargetApi(26)
    fun realTransientAudioFocusLossResumesButCannotOverrideAnExplicitPause()=isolated{
        val manager=context.getSystemService(android.media.AudioManager::class.java)
        val request=android.media.AudioFocusRequest.Builder(android.media.AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_MEDIA).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setOnAudioFocusChangeListener({},android.os.Handler(android.os.Looper.getMainLooper())).build()
        try{
            main{controller.configure(AudioSelection(true,"forest-birds",false,0))};await{playing("forest-birds")}
            main{assertEquals(android.media.AudioManager.AUDIOFOCUS_REQUEST_GRANTED,manager.requestAudioFocus(request))}
            await{!AmbientAudioHost.snapshot().allowed&&!inspect().optBoolean("mainPlaying")}
            val interrupted=inspect();SystemClock.sleep(250);assertEquals(interrupted.getLong("positionMs"),inspect().getLong("positionMs"))
            main{manager.abandonAudioFocusRequest(request)};await{playing("forest-birds")}
            val resumed=decodedAdvance("forest-birds")
            main{assertEquals(android.media.AudioManager.AUDIOFOCUS_REQUEST_GRANTED,manager.requestAudioFocus(request))}
            await{!AmbientAudioHost.snapshot().allowed&&!inspect().optBoolean("mainPlaying")}
            main{controller.pause()};await{AmbientAudioHost.snapshot().paused}
            main{manager.abandonAudioFocusRequest(request)}
            SystemClock.sleep(700);assertTrue(AmbientAudioHost.snapshot().paused);assertFalse(inspect().getBoolean("mainPlaying"))
            val explicitlyPaused=inspect();main{controller.play()};await{playing("forest-birds")}
            val played=decodedAdvance("forest-birds")
            record("focus",JSONObject().put("schema",1).put("interrupted",interrupted).put("automaticResume",resumed)
                .put("explicitlyPaused",explicitlyPaused).put("explicitPlay",played)
                .put("scope","Actual Android focus arbitration between distinct clients of this UID; not another app, call, OEM background or audible listening acceptance"))
        }finally{main{manager.abandonAudioFocusRequest(request)}}
    }
    @Test fun sharedWeatherOwnerSurvivesTheLastUiLeaseOnlyWhileMediaIsAlive()=isolated{
        val runtime=PreviewRuntime.get(context)
        runtime.testDatabase(true).get(30,TimeUnit.SECONDS)
        var owner:NativeEnvironmentSession?=null;val lease=Any()
        val activity=AtomicReference<P3DerivedCacheCheckActivity>()
        foreground.scenario.onActivity{activity.set(it)}
        val stopped=CountDownLatch(1);val resumed=CountDownLatch(1)
        val monitor=androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance()
        val lifecycle=ArrayList<String>()
        val callback=androidx.test.runner.lifecycle.ActivityLifecycleCallback{current,stage->if(current===activity.get()){
            lifecycle+=stage.name
            if(stage==androidx.test.runner.lifecycle.Stage.STOPPED)stopped.countDown()
            if(stage==androidx.test.runner.lifecycle.Stage.RESUMED)resumed.countDown()
        }}
        main{monitor.addLifecycleCallback(callback)}
        fun facts():NativeAtmosphereFacts?{val value=AtomicReference<NativeAtmosphereFacts?>();main{value.set(owner?.latest)};return value.get()}
        fun wire(value:NativeAtmosphereFacts)=JSONObject().put("at",value.time).put("zone",value.inputs.zone).put("ocean",value.inputs.ocean)
            .put("date",value.weather.localDate).put("kind",value.weather.kind.wire).put("precipitationIntensity",value.weather.precipitationIntensity)
        try{
            // This test uses the isolated database's valid default world;
            // no formal record or weather provider configuration is read.
            runtime.testOperation{c->c.command("p3-atmosphere-init",DomainEngine.command("AddQuickNote","noteId" to "p3-environment","text" to "Environment ownership"),System.currentTimeMillis())}.get(30,TimeUnit.SECONDS)
            main{owner=NativeEnvironmentSession.get(context,runtime,controller);owner!!.acquire(lease);owner!!.foreground(lease,true)
                controller.configure(AudioSelection(true,"forest-birds",false,0))}
            await{facts()!=null&&playing("forest-birds")}
            val before=checkNotNull(facts());val position=inspect().getLong("positionMs")
            main{owner!!.foreground(lease,false);owner!!.release(lease);controller.foreground(false)}
            // Use the actual Home path, as in the generated-world lifecycle
            // case. ActivityScenario's stop invoker leaves an empty invoker
            // Activity above this host and only reaches PAUSED on this device.
            assertTrue(androidx.test.uiautomator.UiDevice.getInstance(instrumentation).pressHome())
            assertTrue("Home did not stop the audio test Activity",stopped.await(15,TimeUnit.SECONDS))
            main{assertEquals(androidx.test.runner.lifecycle.Stage.STOPPED,monitor.getLifecycleStageOf(activity.get()))}
            await(85_000){facts()?.time?.let{it>before.time}==true}
            val after=checkNotNull(facts());val playback=inspect()
            assertTrue(playback.getBoolean("mainPlaying"));assertTrue(playback.getLong("positionMs")>position)
            assertEquals(before.inputs,after.inputs);assertEquals(before.weather.localDate,after.weather.localDate)
            context.startActivity(Intent(context,P3DerivedCacheCheckActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            assertTrue("Returning did not resume the audio test Activity",resumed.await(15,TimeUnit.SECONDS))
            main{controller.configure(AudioSelection(volume=0));context.stopService(Intent(context,AmbientAudioService::class.java))}
            await{!AmbientAudioHost.snapshot().active}
            var retired=false
            main{val next=NativeEnvironmentSession.get(context,runtime,controller);retired=next!==owner;val checkLease=Any();next.acquire(checkLease);next.release(checkLease)}
            assertTrue("The idle environment owner must release its worker and subscriptions",retired)
            record("atmosphere",JSONObject().put("schema",1).put("before",wire(before)).put("background",wire(after)).put("playback",playback)
                .put("uiLeaseReleased",true).put("activityStopped",true).put("idleOwnerRetired",retired)
                .put("lifecycle",JSONArray(lifecycle))
                .put("scope","Real application atmosphere ownership and an existing muted media service; no network, location, deep sleep or power-policy claim"))
        }catch(error:Throwable){
            record("atmosphere-failure",JSONObject().put("schema",1).put("exception",error.toString()).put("lifecycle",JSONArray(lifecycle))
                .put("playback",inspect()).put("latestFacts",facts()?.let(::wire)?:JSONObject.NULL))
            throw error
        }finally{
            try{
                context.startActivity(Intent(context,P3DerivedCacheCheckActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            }finally{
                try{main{owner?.release(lease);controller.configure(AudioSelection(volume=0));context.stopService(Intent(context,AmbientAudioService::class.java))}
                    await{!AmbientAudioHost.snapshot().active}
                }finally{try{main{monitor.removeLifecycleCallback(callback)}}finally{runtime.testDatabase(false).get(30,TimeUnit.SECONDS)}}
            }
        }
    }
}
