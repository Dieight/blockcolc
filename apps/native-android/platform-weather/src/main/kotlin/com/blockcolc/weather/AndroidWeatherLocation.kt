package com.blockcolc.weather

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.util.AtomicFile
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

data class WeatherLocationFix(val coordinates:WeatherCoordinates,val source:WeatherLocationSource,val cacheStored:Boolean)

/** Main-thread request API, private-file work on one separate IO lane. The
 * caller owns foreground/permission prompts and the refresh interval. */
class AndroidWeatherLocation(context:Context):AutoCloseable {
    private val application=context.applicationContext
    private val main=Handler(Looper.getMainLooper())
    private val io=Executors.newSingleThreadExecutor{Thread(it,"blockcolc-weather-location-cache")}
    private val cache=AtomicFile(File(application.noBackupFilesDir,"qweather-last-location-v1"))
    private var active:Pending?=null;private var closed=false
    private class Pending(val manager:LocationManager?,val callback:(WeatherResult<WeatherLocationFix>)->Unit){
        val cancelled=AtomicBoolean();var selected=false;var remaining=0
        val signals=ArrayList<CancellationSignal>();val listeners=ArrayList<LocationListener>();var timeout:Runnable?=null
    }
    fun permissionGranted()=application.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED||finePermission()
    private fun finePermission()=application.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED
    fun request(callback:(WeatherResult<WeatherLocationFix>)->Unit):()->Unit {
        checkMain();check(!closed);cancel()
        val pending=Pending(application.getSystemService(LocationManager::class.java),callback);active=pending
        if(!permissionGranted())finish(pending,null,WeatherFailure.LOCATION_PERMISSION_DENIED)
        else{
            val providers=listOfNotNull(LocationManager.NETWORK_PROVIDER,LocationManager.GPS_PROVIDER.takeIf{finePermission()})
                .filter{provider->runCatching{pending.manager?.isProviderEnabled(provider)==true}.getOrDefault(false)}
            pending.remaining=providers.size
            if(providers.isEmpty())finish(pending,null,WeatherFailure.LOCATION_SERVICES_DISABLED)
            else{
                val timeout=Runnable{finish(pending,null,WeatherFailure.LOCATION_UNAVAILABLE)};pending.timeout=timeout;main.postDelayed(timeout,15_000)
                for(provider in providers)requestProvider(pending,provider)
            }
        }
        return {checkMain();if(active===pending)cancel()else pending.cancelled.set(true)}
    }
    @android.annotation.SuppressLint("MissingPermission") // Checked before request and again before acceptance; revocation is handled below.
    private fun requestProvider(pending:Pending,provider:String){
        if(pending.selected||pending.cancelled.get())return
        fun offer(location:Location?){
            if(active!==pending||pending.selected||pending.cancelled.get())return
            val usable=location?.let{runCatching{WeatherCoordinates(it.latitude,it.longitude)}.getOrNull()}
            if(usable!=null)finish(pending,usable,null)
            else{pending.remaining--;if(pending.remaining<=0)finish(pending,null,WeatherFailure.LOCATION_UNAVAILABLE)}
        }
        try{
            if(Build.VERSION.SDK_INT>=30){
                val signal=CancellationSignal();pending.signals+=signal
                pending.manager!!.getCurrentLocation(provider,signal,{main.post(it)},java.util.function.Consumer<Location?>{offer(it)})
            }else{
                @Suppress("DEPRECATION")
                val listener=object:LocationListener {
                    override fun onLocationChanged(location:Location)=offer(location)
                    override fun onProviderDisabled(provider:String)=offer(null)
                    override fun onProviderEnabled(provider:String){}
                    @Deprecated("Legacy Android callback") override fun onStatusChanged(provider:String?,status:Int,extras:Bundle?){}
                }
                pending.listeners+=listener
                @Suppress("DEPRECATION") pending.manager!!.requestSingleUpdate(provider,listener,Looper.getMainLooper())
            }
        }catch(_:SecurityException){if(!permissionGranted())finish(pending,null,WeatherFailure.LOCATION_PERMISSION_DENIED)else offer(null)}
        catch(_:RuntimeException){offer(null)}
    }
    private fun finish(pending:Pending,fresh:WeatherCoordinates?,failure:WeatherFailure?){
        if(active!==pending||pending.selected||pending.cancelled.get())return
        pending.selected=true;stopProviders(pending)
        io.execute{
            if(pending.cancelled.get())return@execute
            val result=if(!permissionGranted())WeatherResult.Unavailable(WeatherFailure.LOCATION_PERMISSION_DENIED)
                else if(fresh!=null)WeatherResult.Available(WeatherLocationFix(fresh,WeatherLocationSource.FRESH,save(fresh)))
                else if(failure==WeatherFailure.LOCATION_PERMISSION_DENIED)WeatherResult.Unavailable(failure)
                else read()?.let{WeatherResult.Available(WeatherLocationFix(it,WeatherLocationSource.CACHED,true))}
                    ?:WeatherResult.Unavailable(failure?:WeatherFailure.LOCATION_UNAVAILABLE)
            main.post{
                if(closed||active!==pending||pending.cancelled.get())return@post
                active=null
                pending.callback(if(permissionGranted())result else WeatherResult.Unavailable(WeatherFailure.LOCATION_PERMISSION_DENIED))
            }
        }
    }
    private fun read():WeatherCoordinates?=try{
        cache.openRead().use{input->
            val out=ByteArrayOutputStream();val buffer=ByteArray(65)
            while(true){val count=input.read(buffer,0,minOf(buffer.size,65-out.size()));if(count<0)break;out.write(buffer,0,count);if(out.size()>64)return null}
            QWeatherProtocol.parseCachedCoordinates(out.toString("UTF-8"))?.let{WeatherCoordinates(it.latitude,it.longitude)}
        }
    }catch(_:Exception){null}
    private fun save(value:WeatherCoordinates):Boolean=try{
        val bytes=QWeatherProtocol.encodeCachedCoordinates(value.latitude,value.longitude).toByteArray(Charsets.UTF_8)
        val stream=cache.startWrite()
        try{stream.write(bytes);cache.finishWrite(stream)}catch(error:Exception){cache.failWrite(stream);throw error}
        read()?.let{QWeatherProtocol.encodeCachedCoordinates(it.latitude,it.longitude).toByteArray(Charsets.UTF_8).contentEquals(bytes)}==true
    }catch(_:Exception){false}
    fun clearCache(callback:(Boolean)->Unit){
        checkMain();check(!closed);cancel()
        io.execute{
            val cleared=runCatching{cache.delete();File(cache.baseFile.path+".new").delete()
                listOf(cache.baseFile,File(cache.baseFile.path+".bak"),File(cache.baseFile.path+".new")).none{it.exists()}}.getOrDefault(false)
            main.post{callback(cleared)}
        }
    }
    fun cancel(){checkMain();active?.let{it.cancelled.set(true);stopProviders(it)};active=null}
    private fun stopProviders(pending:Pending){
        pending.timeout?.let(main::removeCallbacks);pending.timeout=null
        pending.signals.forEach{runCatching{it.cancel()}};pending.signals.clear()
        pending.listeners.forEach{runCatching{pending.manager?.removeUpdates(it)}};pending.listeners.clear()
    }
    override fun close(){checkMain();if(closed)return;cancel();closed=true;io.shutdown()}
    private fun checkMain(){check(Looper.myLooper()==Looper.getMainLooper())}
}
