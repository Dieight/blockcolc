package com.blockcolc.preview

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.blockcolc.presentation.ClientPreferences
import com.blockcolc.presentation.UiResources
import com.blockcolc.preview.ui.*
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import java.io.File

/** The official test-only size override changes density, not device settings.
 * This is a component layout matrix, not a tablet/GPU performance sample. */
@OptIn(ExperimentalTestApi::class)
@RunWith(Parameterized::class)
class P3ComponentLayoutTest(private val width:Int,private val height:Int){
    @get:Rule val compose=createComposeRule()
    companion object {
        @JvmStatic @Parameterized.Parameters(name="{0}x{1}")
        fun windows()=listOf(arrayOf<Any>(320,640),arrayOf<Any>(360,780),arrayOf<Any>(420,900),arrayOf<Any>(600,960),arrayOf<Any>(840,600))
    }
    @Test fun sharedControlsRemainReachableAcrossThemesLanguagesAndLargeFonts(){
        var language by mutableStateOf("en");var dark by mutableStateOf(false);var scale by mutableFloatStateOf(1f)
        var selected by mutableStateOf("system");var checked by mutableStateOf(false);var rounds by mutableIntStateOf(2)
        var expanded by mutableStateOf(false);var note by mutableStateOf(TextFieldValue());var saves by mutableIntStateOf(0)
        val resources=UiResources.load()
        fun text(key:String)=resources.text(language,key)
        compose.setContent{
            DeviceConfigurationOverride(DeviceConfigurationOverride.ForcedSize(DpSize(width.dp,height.dp)) then DeviceConfigurationOverride.FontScale(scale)){
                NativeTheme(ClientPreferences(language=language,fontStyle="mixed",themeMode=if(dark)"dark"else"light"),resources,reduceMotion=true){
                    Column(Modifier.fillMaxSize().testTag("component-window").background(MaterialTheme.colorScheme.background)
                        .verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
                        NativeHeading(text("设置"),text("让专注和世界按你的节奏运行"))
                        NativeSegments(listOf("pixel" to text("像素字体"),"system" to text("系统字体"),"mixed" to text("混合字体")),selected,{selected=it})
                        NativeToggle(text("返回专注提醒"),null,checked){checked=it}
                        NativeNumber(text("专注时长（分钟）"),25,1..180){}
                        NativeStepper(text("计划轮次"),rounds,1,20){rounds=it}
                        NativeTextEntry(text("写一条便签"),note,{note=it},singleLine=false)
                        NativeDisclosure(text("高级与备份"),null,expanded,{expanded=it}){
                            NativeAction(text("恢复默认"),{rounds=2},primary=false,icon="reset")
                        }
                        NativeAction(text("保存"),{saves++},Modifier.fillMaxWidth())
                        NativeAction(text("删除"),{},Modifier.fillMaxWidth(),enabled=false,primary=false)
                    }
                }
            }
        }
        var cases=0;val measurements=JSONArray()
        for((locale,night,fontScale) in listOf(Triple("en",false,1f),Triple("en",true,2f),Triple("zh-CN",false,2f),Triple("zh-CN",true,1f))){
            compose.runOnIdle{language=locale;dark=night;scale=fontScale;expanded=false;checked=false;selected="system"}
            for(label in listOf("像素字体","系统字体","混合字体")){
                val layouts=mutableListOf<TextLayoutResult>()
                compose.onNodeWithText(text(label)).performScrollTo().performSemanticsAction(SemanticsActions.GetTextLayoutResult){assertTrue(it(layouts))}
                val layout=layouts.single();val right=layout.getLineRight(0);val available=layout.layoutInput.constraints.maxWidth
                val context="${width}dp/$locale/$fontScale/${text(label)}: line=$right available=$available text=${layout.size.width} paragraph=${layout.multiParagraph.width}"
                assertEquals("Complete option label at $context",1,layout.lineCount)
                // Paragraphs can retain the full available layout width while
                // Text reports a tight glyph width. Compare actual line bounds
                // with the allocated option, not those two different extents.
                assertTrue("Option is clipped at $context",right<=available+.5f)
                measurements.put(JSONObject().put("locale",locale).put("fontScale",fontScale.toDouble()).put("label",text(label))
                    .put("rightPx",right.toDouble()).put("availablePx",available).put("paragraphWidthPx",layout.multiParagraph.width.toDouble())
                    .put("textWidthPx",layout.size.width).put("reportedOverflowFlag",layout.didOverflowWidth))
            }
            compose.onNodeWithText(text("混合字体")).performClick();compose.runOnIdle{assertEquals("mixed",selected)}
            compose.onNodeWithText(text("返回专注提醒")).performScrollTo().performClick();compose.runOnIdle{assertTrue(checked)}
            compose.onNodeWithText(text("高级与备份")).performScrollTo().performClick()
            compose.onNodeWithText(text("恢复默认")).performScrollTo().assertIsDisplayed()
            val previous=saves;compose.onNodeWithText(text("保存")).performScrollTo().performClick()
            compose.runOnIdle{assertEquals(previous+1,saves)}
            compose.onNodeWithText(text("删除")).performScrollTo().assertIsNotEnabled()
            cases++
        }
        val instrumentation=InstrumentationRegistry.getInstrumentation();val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
        val screenshot="p3-pages-$group-layout-$width.png"
        compose.onNodeWithText(text("系统字体")).performScrollTo();compose.waitForIdle()
        assertTrue(UiDevice.getInstance(instrumentation).takeScreenshot(File(instrumentation.targetContext.filesDir,screenshot)))
        File(instrumentation.targetContext.filesDir,"p3-world-component-layout-$width.json").writeText(JSONObject().put("schema",1).put("caseLabel",group)
            .put("widthDp",width).put("heightDp",height).put("cases",cases).put("measurements",measurements).put("maximumFontScale",2).put("deviceSettingsChanged",false).put("screenshot",screenshot).toString())
    }
}
