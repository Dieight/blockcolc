package com.blockcolc.weather

import java.net.HttpURLConnection
import java.util.Collections

class WeatherCredentials private constructor(internal val host:String,internal val key:String) {
    val configured get()=QWeatherProtocol.isValidQWeatherHost(host)&&QWeatherProtocol.isValidApiKey(key)
    override fun toString()="WeatherCredentials(configured=$configured)"
    companion object {
        fun fromLocalBuild()=WeatherCredentials(BuildConfig.QWEATHER_HOST,BuildConfig.QWEATHER_KEY)
        internal fun supplied(host:String,key:String)=WeatherCredentials(host,key)
    }
}
data class WeatherIdentity(val packageName:String,val certificateSha1:String) {
    init {require(packageName.matches(Regex("[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)+")))
        require(certificateSha1.matches(Regex("(?:[0-9A-F]{2}:){19}[0-9A-F]{2}")))}
}
class WeatherCoordinates(val latitude:Double,val longitude:Double) {
    init {require(latitude.isFinite()&&longitude.isFinite()&&latitude in -90.0..90.0&&longitude in -180.0..180.0){"Invalid weather coordinates"}}
    internal val path get()="${QWeatherProtocol.formatCoordinate(latitude)}/${QWeatherProtocol.formatCoordinate(longitude)}"
    override fun toString()="WeatherCoordinates"
}
enum class WeatherFailure(val wire:String) {
    NOT_CONFIGURED("not_configured"),SIGNING_IDENTITY_UNAVAILABLE("signing_identity_unavailable"),
    REQUEST_CANCELLED("request_cancelled"),NETWORK_UNAVAILABLE("network_unavailable"),REQUEST_TIMEOUT("request_timeout"),
    RESPONSE_TOO_LARGE("response_too_large"),UNSUPPORTED_RESPONSE_ENCODING("unsupported_response_encoding"),
    INVALID_RESPONSE("invalid_response"),REQUEST_FAILED("request_failed"),
    AUTHENTICATION_FAILED("authentication_failed"),SECURITY_RESTRICTION("security_restriction"),INVALID_HOST("invalid_host"),
    QUOTA_EXHAUSTED("quota_exhausted"),BILLING_ISSUE("billing_issue"),ACCOUNT_SUSPENDED("account_suspended"),
    API_DEPRECATED("api_deprecated"),ACCESS_DENIED("access_denied"),RATE_LIMITED("rate_limited"),REQUEST_INVALID("request_invalid"),
    API_PATH_NOT_FOUND("api_path_not_found"),PROVIDER_UNAVAILABLE("provider_unavailable"),
    LOCATION_UNAVAILABLE("location_unavailable"),LOCATION_PERMISSION_DENIED("location_permission_denied"),
    LOCATION_SERVICES_DISABLED("location_services_disabled"),CACHE_CLEAR_FAILED("cache_clear_failed"),UNKNOWN_CONDITION("unknown_condition");
    companion object {internal fun fromWire(value:String)=entries.firstOrNull{it.wire==value}?:REQUEST_FAILED}
}
sealed interface WeatherResult<out T> {
    data class Available<T>(val value:T):WeatherResult<T>
    data class Unavailable(val reason:WeatherFailure):WeatherResult<Nothing>
}
enum class WeatherLocationSource(val wire:String){FRESH("fresh"),CACHED("cached")}
data class WeatherMeasure(val value:Double,val unit:String)
class CurrentWeather internal constructor(val conditionCode:String,val conditionText:String,val cloudCover:Double?,
    val precipitationType:String,val precipitationIntensity:WeatherMeasure?,val observedAt:String?,val fetchedAt:Long,attributions:List<String>,val language:String) {
    val attributions:List<String> = Collections.unmodifiableList(attributions.toList())
}
/** Calendar is validated and detached as JSON text, never a mutable transport object. */
class WeatherCalendar internal constructor(val canonical:String,val coordinates:WeatherCoordinates,val locationSource:WeatherLocationSource,val fetchedAt:Long) {
    fun coversNext48Hours(now:Long)=try{QWeatherAstronomy.Cache.hasContinuousCoverage(org.json.JSONObject(canonical),now)}catch(_:Exception){false}
    val attributions:List<String> by lazy {try{
        val values=org.json.JSONObject(canonical).optJSONArray("attributions")
        Collections.unmodifiableList(if(values==null)emptyList()else List(values.length()){values.getString(it)})
    }catch(_:Exception){emptyList()}}
}

/** Blocking network cancellation; invoke from an IO lane. The application also
 * rejects obsolete results on its own owner thread before publishing them. */
class WeatherRequest {
    private val gate=Any();@Volatile var cancelled=false;private set
    private var connection:HttpURLConnection?=null
    internal fun bind(value:HttpURLConnection)=synchronized(gate){if(cancelled)false else{check(connection==null);connection=value;true}}
    internal fun release(value:HttpURLConnection)=synchronized(gate){if(connection===value)connection=null}
    internal fun <T> publish(action:()->T):WeatherResult<T> = synchronized(gate){
        if(cancelled)WeatherResult.Unavailable(WeatherFailure.REQUEST_CANCELLED)else WeatherResult.Available(action())
    }
    fun cancel()=cancelAsync{it.run()}
    fun cancelAsync(dispatch:(Runnable)->Unit){
        val old=synchronized(gate){cancelled=true;connection.also{connection=null}}
        if(old!=null)dispatch(Runnable{runCatching{old.disconnect()}})
    }
}
