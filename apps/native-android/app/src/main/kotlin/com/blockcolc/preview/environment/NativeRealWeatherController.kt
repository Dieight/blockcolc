package com.blockcolc.preview.environment

import android.app.Application
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.blockcolc.weather.*
import java.util.IdentityHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/** Process-owned platform adapter. A route has no ownership of GPS, network
 * calls or cache cadence. Only the application context is retained. */
class NativeRealWeatherController private constructor(private val application:Application) {
    private val main=Handler(Looper.getMainLooper())
    private val location=AndroidWeatherLocation(application)
    private val number=AtomicInteger()
    private val network=Executors.newFixedThreadPool(2){Thread(it,"blockcolc-weather-network-${number.incrementAndGet()}")}
    private val cancellations=Executors.newSingleThreadExecutor{Thread(it,"blockcolc-weather-cancel")}
    private val client=QWeatherClient(WeatherCredentials.fromLocalBuild(),{AndroidWeatherIdentity.read(application)})
    private val owners=IdentityHashMap<Any,Boolean>();private val listeners=linkedSetOf<(RealWeatherView)->Unit>()
    private var settingsReady=false;private var enabled=false;private var language="zh-CN"
    private val ports=object:RealWeatherPorts {
        override fun permissionGranted()=location.permissionGranted()
        override fun locate(done:(WeatherResult<WeatherLocationFix>)->Unit)=location.request(done)
        override fun weather(location:WeatherLocationFix,language:String,done:(WeatherResult<CurrentWeather>)->Unit):()->Unit {
            val request=WeatherRequest()
            network.execute{val value=runCatching{client.current(location.coordinates,language,request)}
                .getOrElse{WeatherResult.Unavailable(WeatherFailure.REQUEST_FAILED)};main.post{done(value)}}
            return {request.cancelAsync{cancellations.execute(it)}}
        }
        override fun astronomy(location:WeatherLocationFix,done:(WeatherResult<WeatherCalendar>)->Unit):()->Unit {
            val request=WeatherRequest()
            network.execute{val value=runCatching{client.astronomy(location.coordinates,location.source,request)}
                .getOrElse{WeatherResult.Unavailable(WeatherFailure.REQUEST_FAILED)};main.post{done(value)}}
            return {request.cancelAsync{cancellations.execute(it)}}
        }
        override fun clear(done:(Boolean)->Unit){client.clearCalendarCache();location.clearCache(done)}
    }
    private val policy=RealWeatherCoordinator(ports,SystemClock::elapsedRealtime,System::currentTimeMillis,
        {delay,task->main.postDelayed(task,delay);{main.removeCallbacks(task)}},::publish)
    fun acquire(owner:Any){checkMain();check(!owners.containsKey(owner));owners[owner]=false}
    fun foreground(owner:Any,value:Boolean){checkMain();if(!owners.containsKey(owner))return;owners[owner]=value;sync()}
    fun release(owner:Any){checkMain();owners.remove(owner);sync()}
    fun configure(enabled:Boolean,language:String){checkMain();settingsReady=true;this.enabled=enabled;this.language=language;sync()}
    fun preferencesUnavailable(){checkMain();if(settingsReady){settingsReady=false;policy.configure(enabled,false,language)}}
    fun permissionsChanged(){checkMain();if(!location.permissionGranted()&&settingsReady)policy.configure(enabled,false,language)else sync()}
    fun permissionGranted()=location.permissionGranted()
    fun retry(){checkMain();if(settingsReady)policy.retry()}
    fun snapshot():RealWeatherView{checkMain();return policy.latest}
    fun subscribe(listener:(RealWeatherView)->Unit):()->Unit {checkMain();listeners+=listener;listener(policy.latest);return {checkMain();listeners-=listener}}
    private fun sync(){if(settingsReady)policy.configure(enabled,owners.values.any{it},language)}
    private fun publish(view:RealWeatherView){for(listener in listeners.toList())runCatching{listener(view)}
        .onFailure{android.util.Log.w("BlockcolcP3","Weather observer unavailable")}}
    private fun checkMain(){check(Looper.myLooper()==Looper.getMainLooper())}
    companion object {
        private var instance:NativeRealWeatherController?=null
        fun get(context:Context):NativeRealWeatherController {
            check(Looper.myLooper()==Looper.getMainLooper())
            return instance?:NativeRealWeatherController(context.applicationContext as Application).also{instance=it}
        }
    }
}
