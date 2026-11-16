package com.blockcolc.preview.environment

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.blockcolc.audio.AmbientAudioHost
import com.blockcolc.audio.NativeAudioController
import com.blockcolc.preview.PreviewRuntime
import com.blockcolc.world.NativeAtmosphereClock
import com.blockcolc.world.NativeAtmosphereFacts
import com.blockcolc.world.NativeAtmosphereInputs
import com.blockcolc.world.NativeCoordinates
import com.blockcolc.world.NativeWeatherKind
import com.blockcolc.world.NativeWeatherOverride
import com.blockcolc.world.NativeWorldDebug
import com.blockcolc.weather.WeatherAppearance
import java.util.IdentityHashMap
import java.util.TimeZone
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Application-owned facts. No Activity, scene, media player, location request
 * or database lives here. A live audio service can retain this owner after the
 * last UI lease closes; an idle application releases it completely. */
class NativeEnvironmentSession private constructor(private val runtime:PreviewRuntime,private val audio:NativeAudioController,private val weather:NativeRealWeatherController) {
    private val main=Handler(Looper.getMainLooper())
    private val worker=ScheduledThreadPoolExecutor(1){work->Thread(work,"blockcolc-atmosphere")}.apply{removeOnCancelPolicy=true}
    private val owners=IdentityHashMap<Any,Boolean>()
    private val listeners=linkedSetOf<(NativeAtmosphereFacts?)->Unit>()
    private var stopWorld:(()->Unit)?=null;private var stopAudio:(()->Unit)?=null;private var stopWeather:(()->Unit)?=null
    private var ocean:Boolean?=null;private var bound=false;private var closed=false
    private var debug=NativeWorldDebug()
    private val clock=NativeAtmosphereClock(System::currentTimeMillis,
        {delay,task->val future=worker.schedule(task,delay,TimeUnit.MILLISECONDS);{future.cancel(false);Unit}},
        {main.post(it)},::publish,{android.util.Log.w("BlockcolcP3","Atmosphere sampling deferred",it)})
    val latest get()=clock.latest?.takeUnless{it.inputs.coordinates!=null&&!weather.permissionGranted()}

    fun acquire(owner:Any){checkMain();check(!closed);check(!owners.containsKey(owner));owners[owner]=false
        if(!bound){bound=true
            stopWorld=runtime.subscribeWorld{input->ocean=input.environmentStyle=="ocean-island";configure()}
            stopAudio=AmbientAudioHost.subscribe{configure();retireIfIdle()}
            stopWeather=weather.subscribe{configure()}
        }
        configure()
    }
    fun foreground(owner:Any,value:Boolean){checkMain();if(closed||!owners.containsKey(owner))return
        owners[owner]=value;configure();if(value)clock.refresh()
    }
    fun release(owner:Any){checkMain();if(closed)return;owners.remove(owner);configure();retireIfIdle()}
    fun debug(value:NativeWorldDebug){checkMain();if(closed||value==debug)return;debug=value;configure()}
    fun subscribe(listener:(NativeAtmosphereFacts?)->Unit):()->Unit {checkMain();check(!closed);listeners+=listener;listener(latest)
        return {checkMain();listeners-=listener}}
    private fun configure(){
        if(closed)return
        val real=weather.snapshot().takeIf{it.enabled&&!it.clearFailed&&weather.permissionGranted()}
        val coordinates=real?.location?.coordinates?.let{NativeCoordinates(it.latitude,it.longitude)}
        val visual=real?.current?.let(WeatherAppearance::from)
        val override=visual?.let{value->NativeWeatherOverride(NativeWeatherKind.entries.first{it.wire==value.kind},value.thunderstorm,value.cloudIntensity,value.precipitationIntensity)}
        val selected=ocean?.let{debug.project(NativeAtmosphereInputs(TimeZone.getDefault().id,it,coordinates,override))}
        clock.configure(selected,owners.values.any{it}||AmbientAudioHost.snapshot().active)
    }
    private fun publish(facts:NativeAtmosphereFacts){
        if(facts.inputs.coordinates!=null&&!weather.permissionGranted()){weather.permissionsChanged();configure();return}
        runCatching{audio.weather(facts.weather.kind==com.blockcolc.world.NativeWeatherKind.RAIN,facts.weather.precipitationIntensity)}
            .onFailure{AmbientAudioHost.unavailable("AUDIO_WEATHER_UNAVAILABLE")}
        for(listener in listeners.toList())runCatching{listener(facts)}
            .onFailure{android.util.Log.w("BlockcolcP3","Atmosphere observer unavailable",it)}
    }
    private fun retireIfIdle(){
        if(closed||owners.isNotEmpty()||AmbientAudioHost.snapshot().active)return
        closed=true;clock.close();stopWorld?.invoke();stopAudio?.invoke();stopWeather?.invoke();listeners.clear();worker.shutdown()
        if(instance===this)instance=null
    }
    private fun checkMain(){check(Looper.myLooper()==Looper.getMainLooper())}
    companion object {
        private var instance:NativeEnvironmentSession?=null
        fun get(context:Context,runtime:PreviewRuntime,audio:NativeAudioController):NativeEnvironmentSession {
            check(Looper.myLooper()==Looper.getMainLooper())
            return instance?.also{check(it.runtime===runtime&&it.audio===audio)}?:NativeEnvironmentSession(runtime,audio,NativeRealWeatherController.get(context)).also{instance=it}
        }
    }
}
