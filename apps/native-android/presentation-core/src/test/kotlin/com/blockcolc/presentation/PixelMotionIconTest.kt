package com.blockcolc.presentation

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class PixelMotionIconTest {
    @Test fun numericSvgPivotsUseViewCoordinatesEvenWhenTheViewboxStartsNegative(){
        // Browser getCTM probe fixes (5.5,5.5) at (130,130) in a 280px
        // viewport with viewBox -1 -1 14 14, before and after 90deg.
        val icon=PixelMotionIcon.read(JSONObject("""{"viewBox":[-1,-1,14,14],"layers":[{"part":"hand","path":"M5 2h1v4H5z","background":false}],"motions":{"hand":{"origin":"5.5px 5.5px","delay":0,"duration":900,"keyframes":[{"transform":"rotate(0deg)"},{"transform":"rotate(90deg)"}]}}}"""))
        val spec=icon.motions.getValue("hand")
        assertEquals(130f,(spec.originX-icon.minX)/icon.width*280,0f)
        assertEquals(130f,(spec.originY-icon.minY)/icon.height*280,0f)
    }
    @Test fun clocksUseTheActualTwoHandRotationsAndTheSameNineHundredMillisecondRhythm(){
        val icons=UiResources.load().iconMotion;assertTrue(icons.size>=10)
        val clock=icons.getValue("clock");val hour=clock.motions.getValue("hour");val minute=clock.motions.getValue("minute")
        assertEquals(900,hour.duration);assertEquals(900,minute.duration)
        assertEquals(360f,hour.at(900f).rotation,0f);assertEquals(4320f,minute.at(900f).rotation,0f)
        assertEquals(hour.at(450f).rotation*12,minute.at(450f).rotation,.01f)
    }
    @Test fun taskRowsAndChartBarsStaggerWithoutMovingTheirHitTargets(){
        val icons=UiResources.load().iconMotion
        for((name,prefix)in listOf("tasks" to "task-line-","chart" to "bar-")){
            val specs=icons.getValue(name).motions
            for(i in 0..2){val spec=specs.getValue("$prefix$i");assertEquals(i*180,spec.delay);assertEquals(900-i*180,spec.duration)
                assertEquals(0f,spec.at(450f).x,0f);assertEquals(0f,spec.at(450f).y,0f)}
        }
    }
    @Test fun calendarGoesOverTheTopBeforeDisappearingAndUnknownTransformsFailExplicitly(){
        val spec=UiResources.load().iconMotion.getValue("calendar").motions.getValue("turning-page")
        assertEquals(180f,spec.frames.last().value.rotationX,0f);assertEquals(0f,spec.frames.last().value.opacity,0f)
        assertTrue(spec.frames.any{it.value.rotationX in 90f..179f&&it.value.y<0})
        assertThrows(IllegalStateException::class.java){PixelMotionIcon.transform("madeUp(1)",1f)}
    }
}
