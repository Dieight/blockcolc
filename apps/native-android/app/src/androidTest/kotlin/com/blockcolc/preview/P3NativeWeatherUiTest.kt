package com.blockcolc.preview

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.presentation.ClientPreferences
import com.blockcolc.presentation.UiResources
import com.blockcolc.preview.ui.*
import com.blockcolc.weather.*
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

/** Controlled presentation states; screenshots are actual Compose frames,
 * not evidence that the network service succeeded. */
class P3NativeWeatherUiTest {
    @get:Rule val compose=createComposeRule()
    @Test fun permissionFallbackLoadingAndClearRetryStayReadableInBothLanguagesAndThemes(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val resources=UiResources.load();val retries=AtomicInteger()
        var preferences by mutableStateOf(ClientPreferences(themeMode="dark"))
        var enabled by mutableStateOf(true)
        var view by mutableStateOf(RealWeatherView(enabled=true,weather=WeatherSync.FALLBACK,astronomy=AstronomySync.UNAVAILABLE,
            weatherFailure=WeatherFailure.LOCATION_PERMISSION_DENIED))
        compose.setContent{NativeTheme(preferences,resources){
            Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                NativeWeatherSettings(enabled,false,view,{enabled=it},{retries.incrementAndGet()})
            }
        }}
        fun text(key:String,vararg values:Any?)=resources.text(preferences.language,key,*values)
        fun status()=text("天气：{0}",text("本地天气 · {0}",text("需要定位权限")))
        compose.onNodeWithText(status()).assertIsDisplayed()
        compose.onNodeWithText(text("日月：{0}",text("使用本地日月"))).assertIsDisplayed()
        compose.onNodeWithContentDescription(text("重新同步")).performClick();assertEquals(1,retries.get())
        screenshot("weather-zh-dark")
        compose.runOnIdle{preferences=preferences.copy(language="en",themeMode="light")}
        compose.onNodeWithText(status()).assertIsDisplayed();screenshot("weather-en-light")
        compose.runOnIdle{view=view.copy(weather=WeatherSync.SYNCING,astronomy=AstronomySync.SYNCING)}
        compose.onNodeWithText(text("天气：{0}",text("正在同步现实天气"))).assertIsDisplayed()
        compose.onNodeWithContentDescription(text("重新同步")).assertIsNotEnabled()
        compose.runOnIdle{enabled=false;view=RealWeatherView(clearFailed=true)}
        compose.onNodeWithText(text("位置缓存未能清除")).assertIsDisplayed()
        compose.onNodeWithText(text("重试")).performClick();assertEquals(2,retries.get())
        compose.onNodeWithText(text("天气：{0}",text("正在同步现实天气"))).assertDoesNotExist()
        val label=InstrumentationRegistry.getArguments().getString("p3Group")
        require(label!=null&&label.matches(Regex("[a-z0-9-]{1,60}")))
        File(context.filesDir,"p3-world-weather-ui.json").writeText(JSONObject().put("schema",1).put("caseLabel",label)
            .put("languages",JSONArray().put("zh-CN").put("en")).put("themes",JSONArray().put("dark").put("light")).put("retryCallbacks",retries.get())
            .put("loadingRetryDisabled",true).put("disabledClearRetryAvailable",true).put("controlledPresentationOnly",true).toString(),Charsets.UTF_8)
    }
    private fun screenshot(name:String){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val label=checkNotNull(InstrumentationRegistry.getArguments().getString("p3Group"));require(label.matches(Regex("[a-z0-9-]{1,60}")))
        compose.waitForIdle();android.os.SystemClock.sleep(150)
        assertTrue(androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            .takeScreenshot(File(context.filesDir,"p3-pages-$label-$name-${UUID.randomUUID()}.png")))
    }
}
