package com.blockcolc.preview

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.presentation.ClientPreferences
import com.blockcolc.presentation.UiResources
import com.blockcolc.preview.ui.*
import com.blockcolc.world.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.security.MessageDigest

/** Real native panel drawing, motion pause and an inert weather layer. This
 * isolates the approved pixel effect; world/backdrop sampling has other tests. */
class P3PanelWeatherUiTest {
    @get:Rule(order=0) val waiting=P3UiWaitDiagnostics()
    @get:Rule(order=1) val compose=createComposeRule()
    private fun digest(image:ImageBitmap):String {
        val pixels=image.toPixelMap();val hash=MessageDigest.getInstance("SHA-256")
        for(y in 0 until pixels.height)for(x in 0 until pixels.width){
            val c=pixels[x,y]
            hash.update((c.red*255).toInt().toByte());hash.update((c.green*255).toInt().toByte());hash.update((c.blue*255).toInt().toByte())
        }
        return hash.digest().joinToString(""){"%02x".format(it)}
    }
    @Test fun nativeRainSnowAndLightningAnimateWithoutInterceptingThePanelAndPauseWhenHidden(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        var weather by mutableStateOf(NativeWeatherKind.RAIN);var active by mutableStateOf(true)
        var reduce by mutableStateOf(false);var dark by mutableStateOf(true);var clicked=0
        compose.setContent{
            val facts=NativeAtmosphereInputs("UTC",weather=NativeWeatherOverride(weather,weather==NativeWeatherKind.RAIN,precipitationIntensity=.8,visualPrecipitationIntensity=.9)).sample(1793361600000)
            NativeTheme(ClientPreferences(themeMode=if(dark)"dark" else "light"),UiResources.load(),reduceMotion=reduce){
                NativePageActivation(active,LocalNativeAtmosphere provides facts){
                    NativeGlass(100,Modifier.width(340.dp).height(380.dp).testTag("weather-panel")){
                        Column(Modifier.fillMaxSize().padding(20.dp),verticalArrangement=Arrangement.SpaceBetween){
                            Text("25:00");NativeAction("Panel action",{clicked++})
                        }
                    }
                }
            }
        }
        fun capture()=compose.onNodeWithTag("weather-panel").captureToImage()
        val first=digest(capture());android.os.SystemClock.sleep(2300)
        assertNotEquals("Rain is driven by its own active frame clock",first,digest(capture()))
        compose.onNodeWithText("Panel action").performClick();compose.runOnIdle{assertEquals(1,clicked)}
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
        fun screenshot(label:String){
            val bitmap=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            try{File(context.filesDir,"p3-pages-$group-panel-weather-$label.png").outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}}finally{bitmap.recycle()}
        }
        screenshot("rain-storm")
        compose.runOnIdle{active=false};compose.waitForIdle();val paused=digest(capture())
        android.os.SystemClock.sleep(300);assertEquals(paused,digest(capture()))
        compose.runOnIdle{active=true;weather=NativeWeatherKind.SNOW;dark=false}
        android.os.SystemClock.sleep(450);val snow=digest(capture());screenshot("snow")
        android.os.SystemClock.sleep(450);assertNotEquals(snow,digest(capture()))
        compose.runOnIdle{reduce=true};compose.waitForIdle();val still=digest(capture())
        android.os.SystemClock.sleep(250);assertEquals(still,digest(capture()));screenshot("snow-reduced-motion")
    }
}
