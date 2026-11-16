package com.blockcolc.weather

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.time.Instant
import java.util.zip.GZIPOutputStream

class QWeatherClientTest {
    private val credentials=WeatherCredentials.supplied("example.qweatherapi.com","a".repeat(32))
    private val signer=WeatherIdentity("com.example.preview",List(20){"AA"}.joinToString(":"))
    private val coordinate=WeatherCoordinates(39.923,116.415)
    private val epoch=Instant.parse("2026-01-01T00:00:00Z").toEpochMilli()
    private val weather="""{"metadata":{"attributions":["https://www.qweather.com/"]},"condition":{"code":"305","text":"Light rain"},"cloudCover":0.8,"precipitation":{"type":"rain","intensity":{"value":1.4,"unit":"mm/h"}}}"""
    private class Response(url:URL,var body:ByteArray,var status:Int=200,var encoding:String?=null):HttpURLConnection(url){
        var disconnected=false;var opened=false;var onStatus:()->Unit={};var onRead:()->Unit={}
        override fun connect(){}
        override fun usingProxy()=false
        override fun disconnect(){disconnected=true}
        override fun getResponseCode():Int{onStatus();return status}
        override fun getContentEncoding()=encoding
        override fun getInputStream():java.io.InputStream{opened=true;onRead();return ByteArrayInputStream(body)}
        override fun getErrorStream():java.io.InputStream=ByteArrayInputStream(body)
    }
    private fun <T> value(result:WeatherResult<T>):T{assertTrue(result.toString(),result is WeatherResult.Available);return (result as WeatherResult.Available).value}
    private fun failure(result:WeatherResult<*>,reason:WeatherFailure){assertEquals(WeatherResult.Unavailable(reason),result)}
    private fun gzip(text:String)=ByteArrayOutputStream().also{out->GZIPOutputStream(out).use{it.write(text.toByteArray())}}.toByteArray()
    private fun calendar():String {
        val days=(0..6).joinToString(","){n->"""{"forecastStartTime":"${Instant.ofEpochMilli(epoch+n*86_400_000L)}","forecastEndTime":"${Instant.ofEpochMilli(epoch+(n+1)*86_400_000L)}","astro":{"moonPhase":"full-moon"}}"""}
        return """{"metadata":{"attributions":["https://www.qweather.com/"]},"days":[$days]}"""
    }
    @Test fun realRequestShapeUsesHttpsActualSuppliedIdentityGzipAndRequestedLanguage(){
        lateinit var response:Response
        val client=QWeatherClient(credentials,{signer},{epoch}){url->Response(url,gzip(weather),encoding="gzip").also{response=it}}
        val observation=value(client.current(coordinate,"en"))
        assertEquals("https",response.url.protocol);assertEquals("example.qweatherapi.com",response.url.host)
        assertEquals("/weather/v1/current/39.92/116.42",response.url.path);assertEquals("lang=en",response.url.query)
        assertEquals(signer.packageName,response.getRequestProperty("X-Android-Package-Name"));assertEquals(signer.certificateSha1,response.getRequestProperty("X-Android-Cert"))
        assertEquals("a".repeat(32),response.getRequestProperty("X-QW-Api-Key"));assertFalse(response.instanceFollowRedirects)
        assertEquals(8000,response.connectTimeout);assertEquals(10_000,response.readTimeout);assertTrue(response.disconnected)
        assertEquals("305",observation.conditionCode);assertEquals("Light rain",observation.conditionText);assertEquals(.8,observation.cloudCover!!,0.0)
        assertEquals("en",observation.language)
        assertEquals(WeatherMeasure(1.4,"mm/h"),observation.precipitationIntensity);assertEquals(epoch,observation.fetchedAt)
        assertThrows(UnsupportedOperationException::class.java){(observation.attributions as MutableList<String>).clear()}
        value(client.current(coordinate,"zh-CN"));assertEquals("lang=zh",response.url.query)
    }
    @Test fun invalidConfigurationOrAbsentOwnSignerNeverOpensAConnection(){
        var opened=0
        fun client(config:WeatherCredentials,identity:()->WeatherIdentity?)=QWeatherClient(config,identity,{epoch}){opened++;error("Network must not open")}
        failure(client(WeatherCredentials.supplied("evil.invalid","a".repeat(32)),{signer}).current(coordinate,"en"),WeatherFailure.NOT_CONFIGURED)
        failure(client(WeatherCredentials.supplied("example.qweatherapi.com","bad"),{signer}).current(coordinate,"en"),WeatherFailure.NOT_CONFIGURED)
        failure(client(credentials,{null}).current(coordinate,"en"),WeatherFailure.SIGNING_IDENTITY_UNAVAILABLE)
        failure(client(credentials,{throw IOException("Must not expose credential or URL")}).current(coordinate,"en"),WeatherFailure.SIGNING_IDENTITY_UNAVAILABLE)
        assertEquals(0,opened);assertFalse(credentials.toString().contains("a".repeat(32)));assertFalse(credentials.toString().contains("qweatherapi"))
        assertEquals("WeatherCoordinates",coordinate.toString())
    }
    @Test fun providerErrorsEncodingsAndOversizedResponsesProduceOnlySafeReasons(){
        for((status,type,reason)in listOf(Triple(403,"security-restriction",WeatherFailure.SECURITY_RESTRICTION),Triple(401,"unauthorized",WeatherFailure.AUTHENTICATION_FAILED),
            Triple(403,"no-credit",WeatherFailure.QUOTA_EXHAUSTED),Triple(429,"too-many-requests",WeatherFailure.RATE_LIMITED))){
            val client=QWeatherClient(credentials,{signer},{epoch}){url->Response(url,"""{"error":{"type":"https://dev.qweather.com/error#$type","detail":"sensitive response"}}""".toByteArray(),status)}
            val result=client.current(coordinate,"en");failure(result,reason);assertFalse(result.toString().contains("sensitive response"))
        }
        val unsupported=QWeatherClient(credentials,{signer},{epoch}){url->Response(url,weather.toByteArray(),encoding="br")}
        failure(unsupported.current(coordinate,"en"),WeatherFailure.UNSUPPORTED_RESPONSE_ENCODING)
        val tooLarge=QWeatherClient(credentials,{signer},{epoch}){url->Response(url,gzip("x".repeat(65_537)),encoding="gzip")}
        failure(tooLarge.current(coordinate,"en"),WeatherFailure.RESPONSE_TOO_LARGE)
        val invalid=QWeatherClient(credentials,{signer},{epoch}){url->Response(url,"{}".toByteArray())}
        failure(invalid.current(coordinate,"en"),WeatherFailure.INVALID_RESPONSE)
    }
    @Test fun cancellationBeforeOpeningAfterStatusAndAfterReadingRejectsEveryResult(){
        var opened=0;val cancelled=WeatherRequest().also{it.cancel()}
        val before=QWeatherClient(credentials,{signer},{epoch}){opened++;error("No connection expected")}
        failure(before.current(coordinate,"en",cancelled),WeatherFailure.REQUEST_CANCELLED);assertEquals(0,opened)
        for(afterStatus in listOf(true,false)){
            val request=WeatherRequest();lateinit var response:Response
            val client=QWeatherClient(credentials,{signer},{epoch}){url->Response(url,weather.toByteArray()).also{response=it
                if(afterStatus)it.onStatus=request::cancel else it.onRead=request::cancel}}
            failure(client.current(coordinate,"en",request),WeatherFailure.REQUEST_CANCELLED);assertTrue(response.disconnected)
            if(afterStatus)assertFalse(response.opened)
        }
    }
    @Test fun connectionFailuresCannotLeakUrlsHeadersOrExceptionMessages(){
        for((exception,reason)in listOf(SocketTimeoutException("private") to WeatherFailure.REQUEST_TIMEOUT,UnknownHostException("private") to WeatherFailure.NETWORK_UNAVAILABLE,
            ConnectException("private") to WeatherFailure.NETWORK_UNAVAILABLE,IOException("private") to WeatherFailure.REQUEST_FAILED)){
            val client=QWeatherClient(credentials,{signer},{epoch}){throw exception}
            val result=client.current(coordinate,"en");failure(result,reason);assertFalse(result.toString().contains("private"))
        }
    }
    @Test fun calendarUsesSevenDaysAndItsOwnTwelveHourCacheWithDetachedValues(){
        var time=epoch;val responses=ArrayList<Response>()
        val client=QWeatherClient(credentials,{signer},{time}){url->Response(url,calendar().toByteArray()).also{responses+=it}}
        val first=value(client.astronomy(coordinate,WeatherLocationSource.FRESH))
        assertEquals("/weather/v1/daily/39.92/116.42",responses.single().url.path);assertEquals("days=7&localTime=false",responses.single().url.query)
        val damaged=JSONObject(first.canonical);damaged.getJSONArray("days").getJSONObject(0).put("intervalEndMs",0)
        time+=3_600_000
        val cached=value(client.astronomy(WeatherCoordinates(39.924,116.416),WeatherLocationSource.CACHED))
        assertEquals(1,responses.size);assertEquals(epoch,cached.fetchedAt);assertEquals("cached",JSONObject(cached.canonical).getString("locationSource"))
        assertEquals(first.coordinates.latitude,cached.coordinates.latitude,0.0);assertEquals(first.coordinates.longitude,cached.coordinates.longitude,0.0)
        assertNotEquals(0,JSONObject(cached.canonical).getJSONArray("days").getJSONObject(0).getLong("intervalEndMs"))
        time=epoch+12*3_600_000L;value(client.astronomy(coordinate,WeatherLocationSource.FRESH));assertEquals(2,responses.size)
        client.clearCalendarCache();value(client.astronomy(coordinate,WeatherLocationSource.FRESH));assertEquals(3,responses.size)
    }
    @Test fun clearDuringAnInFlightCalendarRequestPreventsCacheResurrection(){
        var calls=0;lateinit var client:QWeatherClient
        client=QWeatherClient(credentials,{signer},{epoch}){url->Response(url,calendar().toByteArray()).also{response->
            calls++;if(calls==1)response.onRead={client.clearCalendarCache()}}}
        failure(client.astronomy(coordinate,WeatherLocationSource.FRESH),WeatherFailure.REQUEST_CANCELLED)
        value(client.astronomy(coordinate,WeatherLocationSource.FRESH));assertEquals(2,calls)
        value(client.astronomy(coordinate,WeatherLocationSource.FRESH));assertEquals(2,calls)
    }
    @Test fun aWeatherFailureDoesNotInvalidateAnIndependentUsableAstronomyCalendar(){
        var calls=0
        val client=QWeatherClient(credentials,{signer},{epoch}){url->calls++;if(url.path.contains("/daily/"))Response(url,calendar().toByteArray())else Response(url,"{}".toByteArray(),503)}
        val first=value(client.astronomy(coordinate,WeatherLocationSource.FRESH));failure(client.current(coordinate,"en"),WeatherFailure.PROVIDER_UNAVAILABLE)
        val again=value(client.astronomy(coordinate,WeatherLocationSource.CACHED));assertEquals(first.fetchedAt,again.fetchedAt);assertEquals(2,calls)
    }
    @Test fun redirectsAreNotFollowedAndGeneratedSourcesContainNoCapacitorRuntime(){
        lateinit var response:Response
        val client=QWeatherClient(credentials,{signer},{epoch}){url->Response(url,ByteArray(0),302).also{response=it}}
        failure(client.current(coordinate,"en"),WeatherFailure.REQUEST_FAILED);assertFalse(response.instanceFollowRedirects)
        val manifest=JSONObject(javaClass.getResource("/native-weather-source.json")!!.readText())
        assertEquals(5,manifest.getJSONArray("sources").length())
        assertThrows(IllegalArgumentException::class.java){WeatherCoordinates(91.0,0.0)}
        assertThrows(IllegalArgumentException::class.java){WeatherIdentity("invalid","wrong")}
    }
    @Test fun localBuildCredentialsAreValidatedWithoutEnteringTheSourceManifest(){
        val local=WeatherCredentials.fromLocalBuild()
        val manifest=javaClass.getResource("/native-weather-source.json")!!.readText()
        if(BuildConfig.QWEATHER_KEY.isEmpty()&&BuildConfig.QWEATHER_HOST.isEmpty())assertFalse(local.configured)
        else{
            assertTrue("Machine-local credentials did not pass their format checks",local.configured)
            assertFalse("A credential entered the source manifest",manifest.contains(BuildConfig.QWEATHER_KEY))
            assertFalse("The private host entered the source manifest",manifest.contains(BuildConfig.QWEATHER_HOST))
        }
    }
}
