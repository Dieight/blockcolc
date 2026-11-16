package com.blockcolc.weather

enum class WeatherSync { NOT_SYNCED,SYNCING,AVAILABLE,FALLBACK }
enum class AstronomySync { NOT_SYNCED,SYNCING,CALENDAR,EPHEMERIS_ONLY,UNAVAILABLE }
data class RealWeatherView(val enabled:Boolean=false,val weather:WeatherSync=WeatherSync.NOT_SYNCED,val astronomy:AstronomySync=AstronomySync.NOT_SYNCED,
    val location:WeatherLocationFix?=null,val current:CurrentWeather?=null,val calendar:WeatherCalendar?=null,
    val weatherFailure:WeatherFailure?=null,val astronomyFailure:WeatherFailure?=null,val clearing:Boolean=false,val clearFailed:Boolean=false)

/** Ports deliver callbacks asynchronously on the same owner lane. The two
 * network requests have independent results and cancellation handles. */
interface RealWeatherPorts {
    fun permissionGranted():Boolean
    fun locate(done:(WeatherResult<WeatherLocationFix>)->Unit):()->Unit
    fun weather(location:WeatherLocationFix,language:String,done:(WeatherResult<CurrentWeather>)->Unit):()->Unit
    fun astronomy(location:WeatherLocationFix,done:(WeatherResult<WeatherCalendar>)->Unit):()->Unit
    fun clear(done:(Boolean)->Unit)
}

/** Foreground synchronization policy, independent of routes, Android windows
 * and rendering. All timestamps for cadence are monotonic; calendar coverage
 * alone uses wall time. Results are checked again on the owner lane. */
class RealWeatherCoordinator(private val ports:RealWeatherPorts,private val elapsed:()->Long,private val wall:()->Long,
    private val schedule:(Long,Runnable)->(()->Unit),private val changed:(RealWeatherView)->Unit):AutoCloseable {
    var latest=RealWeatherView();private set
    private var initialized=false;private var enabled=false;private var foreground=false;private var language="zh-CN"
    private var closed=false;private var epoch=0L;private var clearEpoch=0L;private var hadPermission:Boolean?=null
    private var lastWeather:Long?=null;private var lastAstronomy:Long?=null
    private var lastLocationAttempt:Long?=null
    private var locating=false;private var weatherPending=false;private var astronomyPending=false
    private var cancelLocation:(()->Unit)?=null;private var cancelWeather:(()->Unit)?=null;private var cancelAstronomy:(()->Unit)?=null;private var cancelWake:(()->Unit)?=null
    private fun emit(value:RealWeatherView){if(value!=latest){latest=value;changed(value)}}
    private fun current(version:Long)=!closed&&enabled&&foreground&&version==epoch
    private fun retryable(reason:WeatherFailure?)=reason==null||reason in setOf(WeatherFailure.NETWORK_UNAVAILABLE,WeatherFailure.REQUEST_TIMEOUT,
        WeatherFailure.REQUEST_FAILED,WeatherFailure.PROVIDER_UNAVAILABLE,WeatherFailure.LOCATION_UNAVAILABLE,WeatherFailure.LOCATION_SERVICES_DISABLED)
    fun configure(enabled:Boolean,foreground:Boolean,language:String){
        require(language in setOf("zh-CN","en"));if(closed)return
        val first=!initialized;val turnOn=enabled&&!this.enabled;val turnOff=!enabled&&this.enabled;val localeChanged=this.language!=language
        val becameForeground=foreground&&!this.foreground;val permission=ports.permissionGranted();val granted=hadPermission==false&&permission
        initialized=true;this.enabled=enabled;this.foreground=foreground;this.language=language;hadPermission=permission
        if(!enabled){
            invalidate();lastWeather=null;lastAstronomy=null;lastLocationAttempt=null
            emit(RealWeatherView(clearing=latest.clearing,clearFailed=latest.clearFailed))
            if(first||turnOff)clear()
            return
        }
        emit(latest.copy(enabled=true))
        if(!permission){invalidate();permissionDenied();return}
        if(!foreground){invalidate();settle();return}
        if(first||turnOn||granted){invalidate();lastWeather=null;lastAstronomy=null;kick(force=true);return}
        if(localeChanged||becameForeground&&latest.current?.language?.let{it!=language}==true){
            if(locating)return // The shared location callback uses the latest language.
            if(latest.location!=null&&(latest.current!=null||weatherPending)){invalidate();lastWeather=null;kick(refreshLocation=false)}else wake()
            return
        }
        if(becameForeground||!locating&&!weatherPending&&!astronomyPending)kick()
    }
    fun retry(){
        if(closed)return
        if(latest.clearFailed){clear();return}
        if(!enabled||!foreground)return
        invalidate();if(!ports.permissionGranted()){permissionDenied();return};kick(force=true)
    }
    private fun invalidate(){
        epoch++;if(weatherPending)lastWeather=null;if(astronomyPending)lastAstronomy=null
        listOf(cancelLocation,cancelWeather,cancelAstronomy,cancelWake).forEach{runCatching{it?.invoke()}}
        cancelLocation=null;cancelWeather=null;cancelAstronomy=null;cancelWake=null;locating=false;weatherPending=false;astronomyPending=false
    }
    private fun settle(){emit(latest.copy(weather=if(latest.current!=null)WeatherSync.AVAILABLE else WeatherSync.NOT_SYNCED,
        astronomy=if(latest.calendar!=null)AstronomySync.CALENDAR else if(latest.location!=null)AstronomySync.EPHEMERIS_ONLY else AstronomySync.NOT_SYNCED))}
    private fun permissionDenied(){
        lastWeather=elapsed();lastAstronomy=lastWeather
        emit(latest.copy(location=null,current=null,calendar=null,weather=WeatherSync.FALLBACK,astronomy=AstronomySync.UNAVAILABLE,
            weatherFailure=WeatherFailure.LOCATION_PERMISSION_DENIED,astronomyFailure=WeatherFailure.LOCATION_PERMISSION_DENIED))
    }
    private fun clear(){
        if(closed||latest.clearing)return
        invalidate();val token=++clearEpoch
        emit(RealWeatherView(enabled=enabled,clearing=true))
        ports.clear cleared@{saved->
            if(closed||token!=clearEpoch)return@cleared
            emit(latest.copy(clearing=false,clearFailed=!saved,weatherFailure=if(saved)null else WeatherFailure.CACHE_CLEAR_FAILED))
            if(saved&&enabled&&foreground)kick(force=true)
        }
    }
    private fun weatherDue():Long?=due(lastWeather,latest.weatherFailure,30*60_000L)
    private fun astronomyDue():Long?=due(lastAstronomy,latest.astronomyFailure,
        if(latest.calendar?.coversNext48Hours(wall())==true)12*60*60_000L else 5*60_000L)
    private fun due(last:Long?,reason:WeatherFailure?,normal:Long):Long? {
        if(last==null)return 0
        if(!retryable(reason))return null
        val delay=if(reason==null)normal else 5*60_000L
        val age=elapsed()-last
        return if(age<0)0 else (delay-age).coerceAtLeast(0)
    }
    private fun kick(force:Boolean=false,refreshLocation:Boolean=true){
        if(closed||!enabled||!foreground||latest.clearing||latest.clearFailed||locating||weatherPending||astronomyPending)return
        if(!ports.permissionGranted()){permissionDenied();return}
        val wantWeather=force||weatherDue()==0L;val wantAstronomy=force||astronomyDue()==0L
        if(!wantWeather&&!wantAstronomy){wake();return}
        cancelWake?.invoke();cancelWake=null
        val version=epoch
        emit(latest.copy(weather=if(wantWeather)WeatherSync.SYNCING else latest.weather,astronomy=if(wantAstronomy)AstronomySync.SYNCING else latest.astronomy))
        if(!current(version))return
        val previous=latest.location
        val recent=lastLocationAttempt?.let{elapsed()-it in 0 until 5*60_000L}==true
        if(previous!=null&&(!refreshLocation||!force&&recent)){fetch(version,previous,wantWeather,wantAstronomy);return}
        locating=true
        lastLocationAttempt=elapsed()
        cancelLocation=ports.locate{result->
            if(!current(version))return@locate
            locating=false;cancelLocation=null
            if(!ports.permissionGranted()){invalidate();permissionDenied();return@locate}
            when(result){
                is WeatherResult.Available->fetch(version,result.value,wantWeather,wantAstronomy)
                is WeatherResult.Unavailable->{
                    val fallback=latest.location
                    if(fallback!=null&&result.reason!=WeatherFailure.LOCATION_PERMISSION_DENIED){
                        fetch(version,fallback.copy(source=WeatherLocationSource.CACHED),wantWeather,wantAstronomy)
                    }else{lastWeather=elapsed();lastAstronomy=lastWeather
                        emit(latest.copy(location=null,current=null,calendar=null,weather=WeatherSync.FALLBACK,astronomy=AstronomySync.UNAVAILABLE,
                            weatherFailure=result.reason,astronomyFailure=result.reason));wake()}
                }
            }
        }
    }
    private fun accept(version:Long):Boolean {
        if(!current(version))return false
        if(!ports.permissionGranted()){invalidate();permissionDenied();return false}
        return true
    }
    private fun fetch(version:Long,location:WeatherLocationFix,wantWeather:Boolean,wantAstronomy:Boolean){
        if(!accept(version))return
        emit(latest.copy(location=location));if(!current(version))return
        weatherPending=wantWeather;astronomyPending=wantAstronomy
        if(wantWeather){lastWeather=elapsed();cancelWeather=ports.weather(location,language){result->
            if(!accept(version))return@weather
            weatherPending=false;cancelWeather=null
            when(result){
                is WeatherResult.Available->if(WeatherAppearance.from(result.value)==null)
                    emit(latest.copy(current=null,weather=WeatherSync.FALLBACK,weatherFailure=WeatherFailure.UNKNOWN_CONDITION))
                else emit(latest.copy(current=result.value,weather=WeatherSync.AVAILABLE,weatherFailure=null))
                is WeatherResult.Unavailable->emit(latest.copy(current=null,weather=WeatherSync.FALLBACK,weatherFailure=result.reason))
            };wake()
        }}
        if(wantAstronomy){lastAstronomy=elapsed();cancelAstronomy=ports.astronomy(location){result->
            if(!accept(version))return@astronomy
            astronomyPending=false;cancelAstronomy=null
            when(result){
                is WeatherResult.Available->emit(latest.copy(calendar=result.value,astronomy=AstronomySync.CALENDAR,astronomyFailure=null))
                is WeatherResult.Unavailable->emit(latest.copy(calendar=null,astronomy=AstronomySync.EPHEMERIS_ONLY,astronomyFailure=result.reason))
            };wake()
        }}
    }
    private fun wake(){
        cancelWake?.invoke();cancelWake=null
        if(closed||!enabled||!foreground||locating||weatherPending||astronomyPending||latest.clearing||latest.clearFailed)return
        val delay=listOfNotNull(weatherDue(),astronomyDue()).minOrNull()?:return
        val version=epoch
        cancelWake=schedule(delay.coerceAtLeast(1),Runnable{if(current(version)){cancelWake=null;kick()}})
    }
    override fun close(){if(closed)return;closed=true;invalidate();clearEpoch++}
}
