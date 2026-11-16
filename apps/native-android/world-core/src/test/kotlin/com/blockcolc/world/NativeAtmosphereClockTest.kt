package com.blockcolc.world

import org.junit.Assert.*
import org.junit.Test

class NativeAtmosphereClockTest {
    private class Harness {
        data class Job(val delay:Long,val task:Runnable,var cancelled:Boolean=false)
        var time=java.time.Instant.parse("2026-10-25T15:59:59Z").toEpochMilli()
        val jobs=ArrayList<Job>();val deliveries=java.util.ArrayDeque<Runnable>()
        val values=ArrayList<NativeAtmosphereFacts>();val failures=ArrayList<String>()
        var observer:(NativeAtmosphereFacts)->Unit={}
        var sampler:(NativeAtmosphereInputs,Long)->NativeAtmosphereFacts={input,time->input.sample(time)}
        val clock=NativeAtmosphereClock({time},{delay,task->val job=Job(delay,task);jobs+=job;{job.cancelled=true}},
            {deliveries.addLast(it)},{values+=it;observer(it)},{failures+=it.message?:it.javaClass.simpleName},{input,time->sampler(input,time)})
        fun worker(){jobs.first{!it.cancelled}.also{jobs.remove(it)}.task.run()}
        fun deliver(){deliveries.removeFirst().run()}
        fun tick(){worker();deliver()}
        fun pending()=jobs.filter{!it.cancelled}
    }
    private val inputs=NativeAtmosphereInputs("Asia/Shanghai",true)

    @Test fun oneFactSampleIsSharedAcrossQualitiesAndCameraProjections(){
        val h=Harness();h.clock.configure(inputs,true);h.tick();val facts=h.values.single()
        for(quality in NativeLightingQuality.entries)for(distance in listOf(15.0,150.0)){
            val frame=NativeEnvironmentContext(inputs.zone,quality,25.0,160.0,distance,inputs.ocean).project(facts)
            assertSame(facts.weather,frame.weather);assertSame(facts.sun,frame.sun)
            assertEquals(facts.sun.exposure.toFloat(),frame.lighting.exposure)
        }
        assertEquals(1,h.values.size);assertEquals(60_000L,h.pending().single().delay)
    }
    @Test fun inactiveOwnersDoNoWorkAndResumeImmediatelyAcrossMidnight(){
        val h=Harness();h.clock.configure(inputs,false);assertTrue(h.pending().isEmpty())
        h.clock.configure(inputs,true);h.tick();assertEquals("2026-10-25",h.clock.latest!!.weather.localDate)
        h.clock.configure(inputs,false);assertTrue(h.pending().isEmpty())
        h.time+=2000;h.clock.configure(inputs,true);assertEquals(0L,h.pending().single().delay);h.tick()
        assertEquals("2026-10-26",h.clock.latest!!.weather.localDate);assertEquals(2,h.values.size)
    }
    @Test fun identicalBusinessNotificationsDoNotResampleOrResetTheMinuteCadence(){
        val h=Harness();h.clock.configure(inputs,true);h.tick();val job=h.pending().single()
        repeat(100){h.clock.configure(inputs.copy(),true)}
        assertSame(job,h.pending().single());assertEquals(1,h.values.size)
        h.time+=60_000;h.tick();assertEquals(2,h.values.size)
    }
    @Test fun alreadyDeliveredOldProviderResultCannotReplaceNewInputs(){
        val h=Harness();h.clock.configure(inputs,true);h.worker()
        val storm=inputs.copy(weather=NativeWeatherOverride(NativeWeatherKind.RAIN,true,precipitationIntensity=.2))
        h.clock.configure(storm,true);h.deliver();assertTrue(h.values.isEmpty());assertNull(h.clock.latest)
        h.tick();assertEquals(storm,h.clock.latest!!.inputs);assertTrue(h.clock.latest!!.weather.thunderstorm)
        assertEquals(.2,h.clock.latest!!.weather.precipitationIntensity,0.0);assertEquals(1,h.pending().size)
    }
    @Test fun pauseOrCloseRejectsInFlightDeliveryAndDoesNotScheduleAnotherTick(){
        for(close in listOf(false,true)){
            val h=Harness();h.clock.configure(inputs,true);h.worker()
            if(close)h.clock.close()else h.clock.configure(inputs,false)
            h.deliver();assertTrue(h.values.isEmpty());assertTrue(h.pending().isEmpty())
            if(close){h.clock.configure(inputs,true);h.clock.refresh();assertTrue(h.pending().isEmpty())}
        }
    }
    @Test fun failuresRetainLastFactsAndRetryWithoutPublishingInventedClearWeather(){
        val h=Harness();h.clock.configure(inputs,true);h.tick();val before=h.clock.latest
        h.sampler={_,_->throw IllegalStateException("provider unavailable")};h.time+=60_000;h.tick()
        assertSame(before,h.clock.latest);assertEquals(listOf("provider unavailable"),h.failures)
        assertEquals(60_000L,h.pending().single().delay);assertEquals(1,h.values.size)
        h.sampler={input,time->input.sample(time)};h.time+=60_000;h.tick();assertEquals(2,h.values.size)
    }
    @Test fun observerCanReplaceOrStopItsOwnDemandWithoutLeavingDuplicateTimers(){
        val h=Harness();h.observer={h.clock.configure(inputs,false)}
        h.clock.configure(inputs,true);h.tick();assertTrue(h.pending().isEmpty())
        h.observer={};h.clock.configure(inputs,true);h.tick();val old=h.pending().single()
        h.clock.refresh();assertTrue(old.cancelled);assertEquals(0L,h.pending().single().delay)
        h.tick();assertEquals(1,h.pending().size)
    }
    @Test fun sceneCannotSilentlyAdoptFactsFromAnotherProviderEnvironmentOrZone(){
        val facts=inputs.sample(Harness().time)
        val context=NativeEnvironmentContext("Asia/Shanghai",NativeLightingQuality.HIGH,20.0,100.0,30.0,true)
        assertThrows(IllegalArgumentException::class.java){context.copy(ocean=false).project(facts)}
        assertThrows(IllegalArgumentException::class.java){context.copy(zone="UTC").project(facts)}
        assertThrows(IllegalArgumentException::class.java){NativeAtmosphereInputs("invalid-time-zone")}
    }
    @Test fun explicitProviderAdoptionKeepsSceneQualityGeometryAndCameraProjection(){
        val before=NativeEnvironmentContext("UTC",NativeLightingQuality.HIGH,25.0,160.0,55.0,true,skyOptions=NativeSkyOptions(floating=true))
        val next=NativeAtmosphereInputs("Asia/Shanghai",true,NativeCoordinates(39.92,116.41),NativeWeatherOverride(NativeWeatherKind.RAIN,true)).sample(Harness().time)
        assertThrows(IllegalArgumentException::class.java){before.project(next)}
        val adopted=before.adopting(next)
        assertEquals(before.copy(zone=next.inputs.zone,coordinates=next.inputs.coordinates,weather=next.inputs.weather),adopted)
        assertSame(next.weather,adopted.project(next).weather);assertSame(adopted,adopted.adopting(next))
        assertThrows(IllegalArgumentException::class.java){before.copy(ocean=false).adopting(next)}
    }
}
