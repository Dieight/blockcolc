package com.blockcolc.weather

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RealWeatherCoordinatorTest {
    private class Pending<T>(val done:(WeatherResult<T>)->Unit){var cancelled=false;fun cancel(){cancelled=true}}
    private class Wake(val delay:Long,val run:Runnable){var cancelled=false}
    private class Harness:RealWeatherPorts {
        var permission=true;var time=0L;val wall=1_767_225_600_000L
        val locations=ArrayList<Pending<WeatherLocationFix>>();val weather=ArrayList<Pair<String,Pending<CurrentWeather>>>();val astronomy=ArrayList<Pending<WeatherCalendar>>()
        val clears=ArrayList<(Boolean)->Unit>();val wakes=ArrayList<Wake>();val states=ArrayList<RealWeatherView>()
        val coordinator=RealWeatherCoordinator(this,{time},{wall+time},{delay,task->val wake=Wake(delay,task);wakes+=wake;{wake.cancelled=true}},states::add)
        override fun permissionGranted()=permission
        override fun locate(done:(WeatherResult<WeatherLocationFix>)->Unit):()->Unit {val item=Pending(done);locations+=item;return item::cancel}
        override fun weather(location:WeatherLocationFix,language:String,done:(WeatherResult<CurrentWeather>)->Unit):()->Unit {val item=Pending(done);weather+=language to item;return item::cancel}
        override fun astronomy(location:WeatherLocationFix,done:(WeatherResult<WeatherCalendar>)->Unit):()->Unit {val item=Pending(done);astronomy+=item;return item::cancel}
        override fun clear(done:(Boolean)->Unit){clears+=done}
        fun enable(language:String="zh-CN")=coordinator.configure(true,true,language)
        fun locate()=locations.last().done(WeatherResult.Available(WeatherLocationFix(WeatherCoordinates(39.92,116.41),WeatherLocationSource.FRESH,true)))
        fun weather(code:String="305",language:String=weather.last().first)=CurrentWeather(code,if(language=="en")"Rain"else"小雨",.8,"unknown",null,null,wall+time,listOf("QWeather"),language)
        fun calendar():WeatherCalendar {
            val days=(0..6).joinToString(","){n->"""{"intervalStartMs":${wall+n*86_400_000L},"intervalEndMs":${wall+(n+1)*86_400_000L}}"""}
            return WeatherCalendar("""{"days":[$days]}""",WeatherCoordinates(39.92,116.41),WeatherLocationSource.FRESH,wall+time)
        }
        fun finish(){weather.last().second.done(WeatherResult.Available(weather()));astronomy.last().done(WeatherResult.Available(calendar()))}
        fun nextWake()=wakes.last{!it.cancelled}
        fun wake(){val next=nextWake();next.cancelled=true;time+=next.delay;next.run.run()}
    }
    @Test fun oneColdLocationServesIndependentWeatherAndAstronomyAndNavigationDoesNotRepeatIt(){
        val h=Harness();h.enable();assertEquals(1,h.locations.size);h.locate();assertEquals(1,h.weather.size);assertEquals(1,h.astronomy.size)
        h.finish();assertEquals(WeatherSync.AVAILABLE,h.coordinator.latest.weather);assertEquals(AstronomySync.CALENDAR,h.coordinator.latest.astronomy)
        repeat(50){h.coordinator.configure(true,true,"zh-CN")};assertEquals(1,h.locations.size);assertEquals(30*60_000L,h.nextWake().delay)
        h.time=60_000;h.coordinator.configure(true,false,"zh-CN");h.coordinator.configure(true,true,"zh-CN")
        assertEquals(1,h.locations.size);assertEquals(29*60_000L,h.nextWake().delay)
        h.wake();assertEquals(2,h.locations.size);h.locate();assertEquals(2,h.weather.size);assertEquals(1,h.astronomy.size)
    }
    @Test fun weatherFailurePreservesIndependentAstronomyAndRetriesTransientErrorsAfterFiveMinutes(){
        val h=Harness();h.enable();h.locate()
        h.weather.last().second.done(WeatherResult.Unavailable(WeatherFailure.NETWORK_UNAVAILABLE))
        assertEquals(AstronomySync.SYNCING,h.coordinator.latest.astronomy)
        h.astronomy.last().done(WeatherResult.Available(h.calendar()))
        assertEquals(WeatherSync.FALLBACK,h.coordinator.latest.weather);assertNotNull(h.coordinator.latest.location)
        assertEquals(AstronomySync.CALENDAR,h.coordinator.latest.astronomy);assertEquals(5*60_000L,h.nextWake().delay)
        h.wake();h.locate();assertEquals(2,h.weather.size);assertEquals(1,h.astronomy.size)
    }
    @Test fun permanentApiRestrictionWaitsForManualRetryWhileCoordinatesStillSupportEphemeris(){
        val h=Harness();h.enable();h.locate()
        h.weather.last().second.done(WeatherResult.Unavailable(WeatherFailure.SECURITY_RESTRICTION))
        h.astronomy.last().done(WeatherResult.Unavailable(WeatherFailure.SECURITY_RESTRICTION))
        assertEquals(AstronomySync.EPHEMERIS_ONLY,h.coordinator.latest.astronomy);assertNotNull(h.coordinator.latest.location)
        assertTrue(h.wakes.none{!it.cancelled});repeat(10){h.coordinator.configure(true,true,"zh-CN")};assertEquals(1,h.locations.size)
        h.coordinator.retry();assertEquals(2,h.locations.size)
    }
    @Test fun disablingDropsFactsAndInvalidatesLateResultsBeforeTheCacheClearCompletes(){
        val h=Harness();h.enable();h.locate();val weather=h.weather.last().second;val astronomy=h.astronomy.last()
        h.coordinator.configure(false,true,"zh-CN");assertTrue(weather.cancelled&&astronomy.cancelled);assertTrue(h.coordinator.latest.clearing)
        weather.done(WeatherResult.Available(h.weather()));astronomy.done(WeatherResult.Available(h.calendar()))
        assertNull(h.coordinator.latest.current);assertNull(h.coordinator.latest.location);assertFalse(h.coordinator.latest.enabled)
        h.clears.single()(true);assertFalse(h.coordinator.latest.clearing);assertTrue(h.wakes.none{!it.cancelled})
    }
    @Test fun rapidReenableWaitsForClearBarrierAndFailedClearRequiresExplicitRetry(){
        val h=Harness();h.enable();h.locate();h.finish();h.coordinator.configure(false,true,"zh-CN")
        h.enable();assertEquals(1,h.locations.size);h.clears.single()(false)
        assertTrue(h.coordinator.latest.clearFailed);h.coordinator.configure(true,true,"zh-CN");assertEquals(1,h.locations.size)
        h.coordinator.retry();assertEquals(2,h.clears.size);h.clears.last()(true);assertEquals(2,h.locations.size)
    }
    @Test fun backgroundStopsRequestsAndLateResultsCannotReplaceResumedRequests(){
        val h=Harness();h.enable();val previous=h.locations.single();h.coordinator.configure(true,false,"zh-CN")
        assertTrue(previous.cancelled);h.locate();assertEquals(0,h.weather.size)
        h.coordinator.configure(true,true,"zh-CN");assertEquals(2,h.locations.size);h.locate();h.finish()
        assertEquals(WeatherSync.AVAILABLE,h.coordinator.latest.weather)
    }
    @Test fun returningDuringACancelledNetworkRequestReusesTheRecentLocation(){
        val h=Harness();h.enable();h.locate();val old=h.weather.single().second
        h.time=1000;h.coordinator.configure(true,false,"zh-CN");h.time=2000;h.enable()
        assertEquals(1,h.locations.size);assertEquals(2,h.weather.size);assertTrue(old.cancelled)
        old.done(WeatherResult.Available(h.weather("100")));assertNull(h.coordinator.latest.current)
        h.finish();assertEquals("305",h.coordinator.latest.current!!.conditionCode)
    }
    @Test fun languageChangesUseCurrentCoordinatesAndDoNotRestartPendingLocation(){
        val h=Harness();h.enable();h.enable("en");assertEquals(1,h.locations.size);h.locate();assertEquals("en",h.weather.last().first);h.finish()
        h.enable("zh-CN");assertEquals(1,h.locations.size);assertEquals("zh-CN",h.weather.last().first);assertEquals(2,h.weather.size)
        h.weather.last().second.done(WeatherResult.Available(h.weather()));assertEquals("zh-CN",h.coordinator.latest.current!!.language)
    }
    @Test fun permissionDenialAndRevocationNeverUseCoordinatesEvenInBackground(){
        val h=Harness();h.permission=false;h.enable();assertTrue(h.locations.isEmpty());assertEquals(WeatherFailure.LOCATION_PERMISSION_DENIED,h.coordinator.latest.weatherFailure)
        h.permission=true;h.enable();h.locate();h.finish();assertNotNull(h.coordinator.latest.location)
        h.permission=false;h.coordinator.configure(true,false,"zh-CN")
        assertNull(h.coordinator.latest.location);assertNull(h.coordinator.latest.calendar);assertNull(h.coordinator.latest.current)
        assertEquals(AstronomySync.UNAVAILABLE,h.coordinator.latest.astronomy)
    }
    @Test fun invalidProviderConditionFallsBackAndPartialCalendarUsesShortRetry(){
        val h=Harness();h.enable();h.locate();h.weather.last().second.done(WeatherResult.Available(h.weather("999")))
        h.astronomy.last().done(WeatherResult.Available(WeatherCalendar("""{"days":[{"intervalStartMs":${h.wall},"intervalEndMs":${h.wall+86_400_000L}}]}""",
            WeatherCoordinates(39.92,116.41),WeatherLocationSource.FRESH,h.wall)))
        assertEquals(WeatherFailure.UNKNOWN_CONDITION,h.coordinator.latest.weatherFailure);assertEquals(5*60_000L,h.nextWake().delay)
        h.wake();h.locate();assertEquals(1,h.weather.size);assertEquals(2,h.astronomy.size)
    }
    @Test fun lostLocationCanUseInMemoryCoordinatesOnlyWhilePermissionStillExists(){
        val h=Harness();h.enable();h.locate();h.finish();h.wake()
        h.locations.last().done(WeatherResult.Unavailable(WeatherFailure.LOCATION_UNAVAILABLE))
        assertEquals(WeatherLocationSource.CACHED,h.coordinator.latest.location!!.source);assertEquals(2,h.weather.size)
    }
    @Test fun closingRejectsAlreadyPostedResultsAndClearCompletionWithoutRearmingTimers(){
        val h=Harness();h.enable();h.locate();h.coordinator.close();val before=h.coordinator.latest
        h.weather.last().second.done(WeatherResult.Available(h.weather()));h.astronomy.last().done(WeatherResult.Available(h.calendar()))
        h.enable();h.coordinator.retry();assertSame(before,h.coordinator.latest);assertTrue(h.wakes.none{!it.cancelled})
        val off=Harness();off.coordinator.configure(false,true,"zh-CN");off.coordinator.close();val disabled=off.coordinator.latest
        off.clears.single()(true);assertSame(disabled,off.coordinator.latest)
    }
    @Test fun providerVisualMappingPreservesSnowPriorityUnitsAndExplicitThunder(){
        fun input(code:String,type:String="unknown",measure:WeatherMeasure?=null)=CurrentWeather(code,"Condition",null,type,measure,null,0,emptyList(),"en")
        assertTrue(WeatherAppearance.from(input("302"))!!.thunderstorm);assertFalse(WeatherAppearance.from(input("305"))!!.thunderstorm)
        assertEquals("snow",WeatherAppearance.from(input("302","mixed"))!!.kind)
        assertEquals(.508,WeatherAppearance.from(input("305",measure=WeatherMeasure(.1,"in/h")))!!.precipitationIntensity,1e-10)
        assertEquals(.3,WeatherAppearance.from(input("305",measure=WeatherMeasure(5.0,"unknown")))!!.precipitationIntensity,0.0)
        assertEquals("mist",WeatherAppearance.from(input("509"))!!.kind);assertNull(WeatherAppearance.from(input("999")))
    }
}
