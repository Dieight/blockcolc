package com.blockcolc.weather

import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException

/** Blocking HTTPS transport. It does not request permission/location, own the
 * refresh cadence, start services, or expose response/exception text to UI. */
class QWeatherClient(
    private val credentials:WeatherCredentials,
    private val identity:()->WeatherIdentity?,
    private val now:()->Long=System::currentTimeMillis,
    private val open:(URL)->HttpURLConnection={it.openConnection() as HttpURLConnection}
) {
    private val calendar=QWeatherAstronomy.Cache()
    private val calendarGate=Any();private var calendarGeneration=0L
    fun current(coordinates:WeatherCoordinates,language:String,request:WeatherRequest=WeatherRequest()):WeatherResult<CurrentWeather>{
        require(language in setOf("zh-CN","en"))
        val lang=if(language=="en")"en"else"zh"
        return exchange("/weather/v1/current/${coordinates.path}?lang=$lang",request){body->
            QWeatherProtocol.mapResponse(body)?.let{result->
                val current=result.getJSONObject("current");val intensity=current.optJSONObject("precipitationIntensity")
                CurrentWeather(current.getString("conditionCode"),current.getString("conditionText"),
                    (current.opt("cloudCover") as? Number)?.toDouble(),current.getString("precipitationType"),
                    intensity?.let{WeatherMeasure(it.getDouble("value"),it.getString("unit"))},
                    result.optString("observedAt","").takeIf{it.isNotEmpty()},now(),
                    result.getJSONArray("attributions").let{values->List(values.length()){values.getString(it)}},language)
            }
        }
    }
    fun astronomy(coordinates:WeatherCoordinates,source:WeatherLocationSource,request:WeatherRequest=WeatherRequest()):WeatherResult<WeatherCalendar>{
        if(request.cancelled)return failure(WeatherFailure.REQUEST_CANCELLED)
        val at=now()
        val (version,cached)=synchronized(calendarGate){calendarGeneration to calendar.get(coordinates.latitude,coordinates.longitude,at)}
        cached?.let{
            cached.put("locationSource",source.wire)
            return synchronized(calendarGate){if(version!=calendarGeneration)failure(WeatherFailure.REQUEST_CANCELLED)
                else request.publish{val point=cached.getJSONObject("coordinate")
                    WeatherCalendar(cached.toString(),WeatherCoordinates(point.getDouble("latitude"),point.getDouble("longitude")),source,cached.getLong("fetchedAtMs"))}}
        }
        val result=exchange("/weather/v1/daily/${coordinates.path}?days=7&localTime=false",request){body->
            QWeatherAstronomy.mapResponse(body,coordinates.latitude,coordinates.longitude,source.wire,now())
        }
        return when(result){
            is WeatherResult.Unavailable->result
            is WeatherResult.Available->synchronized(calendarGate){
                if(version!=calendarGeneration)failure(WeatherFailure.REQUEST_CANCELLED)
                else request.publish{calendar.put(result.value);WeatherCalendar(result.value.toString(),coordinates,source,result.value.getLong("fetchedAtMs"))}
            }
        }
    }
    fun clearCalendarCache()=synchronized(calendarGate){calendarGeneration++;calendar.clear()}
    private fun <T> failure(reason:WeatherFailure):WeatherResult<T> = WeatherResult.Unavailable(reason)
    private fun <T> exchange(route:String,request:WeatherRequest,decode:(String)->T?):WeatherResult<T>{
        if(request.cancelled)return failure(WeatherFailure.REQUEST_CANCELLED)
        if(!credentials.configured)return failure(WeatherFailure.NOT_CONFIGURED)
        val signer=try{identity()}catch(_:Exception){null}?:return failure(WeatherFailure.SIGNING_IDENTITY_UNAVAILABLE)
        var connection:HttpURLConnection?=null
        try{
            val next=open(URL("https://${credentials.host}$route"));connection=next
            if(!request.bind(next))return failure(WeatherFailure.REQUEST_CANCELLED)
            next.requestMethod="GET";next.connectTimeout=8000;next.readTimeout=10_000;next.instanceFollowRedirects=false
            next.setRequestProperty("Accept","application/json");next.setRequestProperty("Accept-Encoding","gzip")
            next.setRequestProperty("X-QW-Api-Key",credentials.key)
            next.setRequestProperty("X-Android-Package-Name",signer.packageName);next.setRequestProperty("X-Android-Cert",signer.certificateSha1)
            if(request.cancelled)return failure(WeatherFailure.REQUEST_CANCELLED)
            val status=next.responseCode
            if(request.cancelled)return failure(WeatherFailure.REQUEST_CANCELLED)
            if(status !in 200..299){
                val body=try{next.errorStream?.let{QWeatherProtocol.decodeWeatherResponse(it,next.contentEncoding)}}catch(_:Exception){null}
                return failure(if(request.cancelled)WeatherFailure.REQUEST_CANCELLED else WeatherFailure.fromWire(QWeatherProtocol.mapHttpFailure(status,body)))
            }
            val body=QWeatherProtocol.decodeWeatherResponse(next.inputStream,next.contentEncoding)
            if(request.cancelled)return failure(WeatherFailure.REQUEST_CANCELLED)
            val value=decode(body)?:return failure(if(request.cancelled)WeatherFailure.REQUEST_CANCELLED else WeatherFailure.INVALID_RESPONSE)
            return request.publish{value}
        }catch(_:QWeatherProtocol.ResponseTooLargeException){return failure(if(request.cancelled)WeatherFailure.REQUEST_CANCELLED else WeatherFailure.RESPONSE_TOO_LARGE)}
        catch(_:QWeatherProtocol.UnsupportedResponseEncodingException){return failure(if(request.cancelled)WeatherFailure.REQUEST_CANCELLED else WeatherFailure.UNSUPPORTED_RESPONSE_ENCODING)}
        catch(_:SocketTimeoutException){return failure(if(request.cancelled)WeatherFailure.REQUEST_CANCELLED else WeatherFailure.REQUEST_TIMEOUT)}
        catch(_:UnknownHostException){return failure(if(request.cancelled)WeatherFailure.REQUEST_CANCELLED else WeatherFailure.NETWORK_UNAVAILABLE)}
        catch(_:ConnectException){return failure(if(request.cancelled)WeatherFailure.REQUEST_CANCELLED else WeatherFailure.NETWORK_UNAVAILABLE)}
        catch(_:Exception){return failure(if(request.cancelled)WeatherFailure.REQUEST_CANCELLED else WeatherFailure.REQUEST_FAILED)}
        finally{connection?.let{request.release(it);runCatching{it.disconnect()}}}
    }
}
