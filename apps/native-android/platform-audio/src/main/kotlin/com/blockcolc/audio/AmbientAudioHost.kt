package com.blockcolc.audio

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import org.json.JSONArray
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArrayList

data class AudioPlayback(val active:Boolean=false,val allowed:Boolean=false,val paused:Boolean=false,val primary:String="",
    val mainReady:Boolean=false,val rainReady:Int=0,val rainRequested:Boolean=false,val volume:Int=30,val durationMs:Long=0,val error:String?=null)

/** Small status projection; no player, file or focus-plan handle is exposed to UI. */
object AmbientAudioHost {
    private val main=Handler(Looper.getMainLooper())
    private val listeners=CopyOnWriteArrayList<(AudioPlayback)->Unit>()
    @Volatile private var value=AudioPlayback()
    private var service=WeakReference<AmbientAudioService>(null)
    private var language="zh-CN"
    private var rainMask=0
    private val debugEvents=java.util.ArrayDeque<JSONObject>()
    fun snapshot()=value
    fun subscribe(listener:(AudioPlayback)->Unit):()->Unit {listeners+=listener;listener(value);return {listeners-=listener}}
    private fun publish(next:AudioPlayback){if(next==value)return;value=next
        if(BuildConfig.DEBUG){debugEvents.addLast(JSONObject().put("at",android.os.SystemClock.elapsedRealtime()).put("active",next.active).put("allowed",next.allowed)
            .put("paused",next.paused).put("primary",next.primary).put("mainReady",next.mainReady).put("rainReady",next.rainReady).put("error",next.error?:JSONObject.NULL));while(debugEvents.size>64)debugEvents.removeFirst()}
        for(listener in listeners)listener(next)}
    fun language(value:String){check(Looper.myLooper()==Looper.getMainLooper());language=if(value=="en")"en"else"zh-CN"}
    @JvmStatic fun text(context:Context,chinese:String,english:String)=if(language=="en")english else chinese
    @JvmStatic fun openIntent(context:Context):Intent=context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?:Intent().setPackage(context.packageName)
    @JvmStatic fun created(owner:AmbientAudioService){service=WeakReference(owner);rainMask=0;publish(AudioPlayback(active=true))}
    @JvmStatic fun selection(owner:AmbientAudioService,primary:String,rain:Boolean,gain:Float){if(service.get()!==owner)return
        publish(value.copy(primary=primary,rainRequested=rain,volume=(gain*100).toInt(),mainReady=value.primary==primary&&value.mainReady,
            durationMs=if(value.primary==primary)value.durationMs else 0,error=null))}
    @JvmStatic fun playback(owner:AmbientAudioService,allowed:Boolean,paused:Boolean){if(service.get()===owner)publish(value.copy(allowed=allowed,paused=paused))}
    @JvmStatic fun mainPrepared(owner:AmbientAudioService,duration:Int){if(service.get()===owner)publish(value.copy(mainReady=true,durationMs=duration.toLong()))}
    @JvmStatic fun isMainPrepared(owner:AmbientAudioService)=service.get()===owner&&value.mainReady&&value.error==null
    @JvmStatic fun rainPrepared(owner:AmbientAudioService,layer:Int){if(service.get()!==owner)return;rainMask=rainMask or(1 shl layer)
        publish(value.copy(rainReady=Integer.bitCount(rainMask)))}
    @JvmStatic fun rainCleared(owner:AmbientAudioService){if(service.get()===owner){rainMask=0;publish(value.copy(rainReady=0))}}
    @JvmStatic fun failed(owner:AmbientAudioService,code:String){if(service.get()===owner)publish(value.copy(error=code))}
    @JvmStatic fun closed(owner:AmbientAudioService){if(service.get()!==owner)return;service.clear();rainMask=0
        publish(AudioPlayback(paused=value.paused,volume=value.volume,error=value.error))}
    /** Must run on the media/main thread; callers receive only fresh scalar diagnostics. */
    fun inspect():JSONObject {check(Looper.myLooper()==Looper.getMainLooper());val current=value
        return (service.get()?.inspectPlayback()?:JSONObject().put("active",false)).put("projection",JSONObject().put("active",current.active).put("allowed",current.allowed)
            .put("paused",current.paused).put("mainReady",current.mainReady).put("rainReady",current.rainReady).put("primary",current.primary).put("error",current.error?:JSONObject.NULL))
            .also{if(BuildConfig.DEBUG)it.put("debugEvents",JSONArray(debugEvents.map{event->JSONObject(event.toString())}))}}
    fun unavailable(code:String){main.post{publish(value.copy(error=code))}}
}
